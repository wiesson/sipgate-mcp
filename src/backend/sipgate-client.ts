import { requestJournal, type JournalEntry } from "../request-journal.js";
import type { JsonValue } from "./telephony-backend.js";

const DEFAULT_BASE_URL = "https://api.sipgate.com/v2";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 1_000;
/** A longer server-requested wait is reported instead of blocking the tool call. */
const MAX_RETRY_DELAY_MS = 5_000;
/** Enough for any recognised denial sentence; the rest of an error body is never read. */
const MAX_ERROR_BODY_BYTES = 4_096;

type QueryValue = string | number | boolean | readonly (string | number | boolean)[] | undefined;

export interface SipgateClientOptions {
  tokenId: string;
  token: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  /** Deadline per attempt, covering both the response headers and the body. */
  timeoutMs?: number;
  /** Replaceable so tests do not wait through retry delays. */
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, QueryValue>;
  body?: JsonValue;
  accept?: string;
}

export class SipgateApiError extends Error {
  public readonly status: number | undefined;

  public constructor(message: string, status?: number) {
    super(message);
    this.name = "SipgateApiError";
    this.status = status;
  }
}

/**
 * sipgate explains some denials in a short plain-text body, for example
 * "This endpoint requires a sipgate Classic PBX Account". Only sentences known
 * to be sipgate's own static text are shown, and they are shown from this list
 * rather than from the response: any other body is dropped, because text from
 * the network must not reach an agent's context as if it were guidance.
 */
const KNOWN_DENIALS = [
  "This endpoint requires a sipgate Classic PBX Account",
];

function knownDenial(body: string): string {
  const sentence = body.trim().replace(/\.$/, "");
  const known = KNOWN_DENIALS.find((denial) => denial === sentence);
  return known ? ` sipgate says: "${known}"` : "";
}

/** Parses Retry-After (delta seconds or an HTTP date) without ever echoing it. */
function retryAfterSeconds(header: string | null, now: number): number | undefined {
  const value = header?.trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - now) / 1000));
}

const WRITE_OUTCOME_UNKNOWN =
  " The change or chargeable action may still have been applied, so check the current state before retrying.";

function errorForStatus(
  status: number,
  method: string,
  retryAfter: number | undefined,
  path: string,
  detail: string,
): SipgateApiError {
  switch (status) {
    case 401:
      return new SipgateApiError(
        "sipgate authentication failed (HTTP 401). Check SIPGATE_TOKEN_ID and SIPGATE_TOKEN.",
        status,
      );
    case 403:
      return new SipgateApiError(
        `sipgate denied ${path} (HTTP 403).${detail} The Personal Access Token may be missing a required PAT scope for it, or the account may not include this feature. Other endpoints can still work, so check the token's scopes for this one specifically.`,
        status,
      );
    case 404:
      return new SipgateApiError(
        "The requested sipgate resource was not found (HTTP 404). Check the supplied user, device, phoneline, number, or extension ID.",
        status,
      );
    case 429: {
      const suffix = retryAfter === undefined ? " Retry later." : ` Retry after ${retryAfter} seconds.`;
      return new SipgateApiError(`sipgate rate limit exceeded (HTTP 429).${suffix}`, status);
    }
    default: {
      // A server error on a write says nothing about whether sipgate acted on it.
      const outcome = status >= 500 && method !== "GET" ? WRITE_OUTCOME_UNKNOWN : "";
      const reason = status === 502 || status === 503 || status === 504
        ? `sipgate is temporarily unavailable (HTTP ${status}).`
        : `sipgate rejected the request (HTTP ${status}).`;
      return new SipgateApiError(`${reason}${outcome || (status >= 500 ? " Try again later." : "")}`, status);
    }
  }
}

/**
 * Only a read can be repeated safely: a write that sipgate throttled may still
 * be retried by the caller, but never behind its back.
 */
function retryDelay(method: string, status: number, retryAfter: number | undefined): number | undefined {
  if (method !== "GET" || (status !== 429 && status !== 503)) return undefined;
  if (retryAfter === undefined) return DEFAULT_RETRY_DELAY_MS;
  const delay = retryAfter * 1000;
  return delay > MAX_RETRY_DELAY_MS ? undefined : delay;
}

/** Only plain identifiers of a confirmation body are kept, never its content. */
const IDENTIFIER_KEYS = ["sessionId", "callId", "faxId", "id"];
const PLAIN_IDENTIFIER = /^[\w.:-]{1,128}$/;

function confirmationIdentifiers(
  text: string,
  containsSecret: (value: string) => boolean,
): JournalEntry["identifiers"] {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const found = Object.fromEntries(IDENTIFIER_KEYS.flatMap((key): Array<[string, string | number]> => {
    const value = (body as Record<string, unknown>)[key];
    // Checked after decoding: a JSON escape must not smuggle a credential past it.
    if (typeof value === "number") return containsSecret(String(value)) ? [] : [[key, value]];
    return typeof value === "string" && PLAIN_IDENTIFIER.test(value) && !containsSecret(value)
      ? [[key, value]]
      : [];
  }));
  return Object.keys(found).length > 0 ? found : undefined;
}

async function readBounded(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).subarray(0, maxBytes).toString("utf8");
}

export class SipgateClient {
  readonly #baseUrl: string;
  readonly #authorization: string;
  readonly #secrets: string[];
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;
  readonly #sleep: (milliseconds: number) => Promise<void>;

  public constructor(options: SipgateClientOptions) {
    if (!options.tokenId || !options.token) {
      throw new SipgateApiError(
        "Both SIPGATE_TOKEN_ID and SIPGATE_TOKEN must be set in the server environment.",
      );
    }

    const credential = Buffer.from(`${options.tokenId}:${options.token}`, "utf8").toString("base64");
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.#authorization = `Basic ${credential}`;
    // Longest first, so a secret that contains another is replaced whole.
    this.#secrets = [credential, options.token, options.tokenId]
      .sort((left, right) => right.length - left.length);
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#sleep = options.sleep
      ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  public async request<T extends JsonValue | undefined>(
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const { status, text } = await this.send(path, options);
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      // sipgate accepted the write; an unreadable confirmation body must not
      // read as a failure that invites a second SMS or call.
      if ((options.method ?? "GET") !== "GET") return undefined as T;
      throw new SipgateApiError("sipgate returned an unexpected non-JSON response.", status);
    }
  }

  public async requestText(path: string, options: RequestOptions = {}): Promise<string> {
    return (await this.send(path, options)).text;
  }

  #redact(text: string): string {
    return this.#secrets.reduce((redacted, secret) => redacted.split(secret).join("[REDACTED]"), text);
  }

  #record(method: string, url: URL, ok: boolean, text = ""): void {
    const journal = requestJournal.getStore();
    if (!journal) return;
    const identifiers = ok && method !== "GET"
      ? confirmationIdentifiers(text, (value) => this.#redact(value) !== value)
      : undefined;
    journal.push({
      method,
      path: this.#redact(url.pathname),
      ok,
      ...(identifiers === undefined ? {} : { identifiers }),
    });
  }

  /** Every error leaves the client scrubbed, including interpolated paths. */
  #error(message: string, status?: number): SipgateApiError {
    return new SipgateApiError(this.#redact(message), status);
  }

  private async send(
    path: string,
    options: RequestOptions,
  ): Promise<{ status: number; text: string }> {
    const method = options.method ?? "GET";
    const url = new URL(`${this.#baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
    for (const [name, value] of Object.entries(options.query ?? {})) {
      if (value === undefined) continue;
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) url.searchParams.append(name, String(item));
    }

    const headers: Record<string, string> = {
      Accept: options.accept ?? "application/json",
      Authorization: this.#authorization,
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";

    for (let attempt = 0; ; attempt += 1) {
      // One deadline per attempt bounds the headers and the body read together.
      // AbortSignal.timeout() is not used: its timer is unref'd, so on Node 22
      // it never fires while nothing else keeps the event loop alive.
      const controller = new AbortController();
      const { signal } = controller;
      const deadline = setTimeout(
        () => controller.abort(new DOMException("The sipgate request timed out.", "TimeoutError")),
        this.#timeoutMs,
      );
      try {
        const response = await this.#fetch(url, {
          method,
          headers,
          signal,
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        });
        if (response.ok) {
          const text = response.status === 204 ? "" : await response.text();
          this.#record(method, url, true, text);
          return { status: response.status, text };
        }

        const retryAfter = retryAfterSeconds(response.headers.get("retry-after"), Date.now());
        const delay = attempt === 0 ? retryDelay(method, response.status, retryAfter) : undefined;
        if (delay !== undefined) {
          await response.body?.cancel().catch(() => {});
          await this.#sleep(delay);
          continue;
        }
        let detail = "";
        if (response.status === 403) {
          // A stalled body still times out below; any other read failure
          // leaves the status as the most precise information available.
          detail = knownDenial(await readBounded(response, MAX_ERROR_BODY_BYTES).catch((error: unknown) => {
            if (signal.aborted) throw error;
            return "";
          }));
        } else {
          await response.body?.cancel().catch(() => {});
        }
        const failure = errorForStatus(response.status, method, retryAfter, url.pathname, detail);
        this.#record(method, url, false);
        throw this.#error(failure.message, failure.status);
      } catch (error) {
        if (error instanceof SipgateApiError) throw error;
        this.#record(method, url, false);
        const outcome = method === "GET" ? "" : WRITE_OUTCOME_UNKNOWN;
        if (signal.aborted) {
          throw this.#error(
            `sipgate did not answer within ${Math.round(this.#timeoutMs / 1000)} seconds.${outcome || " Try again later."}`,
          );
        }
        throw this.#error(
          `Could not reach the sipgate API.${outcome || " Check the network connection and try again."}`,
        );
      } finally {
        clearTimeout(deadline);
      }
    }
  }
}
