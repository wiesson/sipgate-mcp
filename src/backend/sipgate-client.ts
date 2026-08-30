import type { JsonValue } from "./telephony-backend.js";

const DEFAULT_BASE_URL = "https://api.sipgate.com/v2";

type QueryValue = string | number | boolean | readonly (string | number | boolean)[] | undefined;

export interface SipgateClientOptions {
  tokenId: string;
  token: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
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

function errorForStatus(status: number, retryAfter: string | null): SipgateApiError {
  switch (status) {
    case 401:
      return new SipgateApiError(
        "sipgate authentication failed (HTTP 401). Check SIPGATE_TOKEN_ID and SIPGATE_TOKEN.",
        status,
      );
    case 403:
      return new SipgateApiError(
        "sipgate denied this operation (HTTP 403). The Personal Access Token may be missing a required PAT scope or the account may not include this feature.",
        status,
      );
    case 404:
      return new SipgateApiError(
        "The requested sipgate resource was not found (HTTP 404). Check the supplied user, device, phoneline, number, or extension ID.",
        status,
      );
    case 429: {
      const suffix = retryAfter ? ` Retry after ${retryAfter} seconds.` : " Retry later.";
      return new SipgateApiError(`sipgate rate limit exceeded (HTTP 429).${suffix}`, status);
    }
    default:
      return new SipgateApiError(`sipgate rejected the request (HTTP ${status}).`, status);
  }
}

export class SipgateClient {
  readonly #baseUrl: string;
  readonly #authorization: string;
  readonly #fetch: typeof globalThis.fetch;

  public constructor(options: SipgateClientOptions) {
    if (!options.tokenId || !options.token) {
      throw new SipgateApiError(
        "Both SIPGATE_TOKEN_ID and SIPGATE_TOKEN must be set in the server environment.",
      );
    }

    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.#authorization = `Basic ${Buffer.from(`${options.tokenId}:${options.token}`, "utf8").toString("base64")}`;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  public async request<T extends JsonValue | undefined>(
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const response = await this.fetch(path, options);
    if (response.status === 204) return undefined as T;

    const text = await response.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new SipgateApiError("sipgate returned an unexpected non-JSON response.", response.status);
    }
  }

  public async requestText(path: string, options: RequestOptions = {}): Promise<string> {
    const response = await this.fetch(path, options);
    if (response.status === 204) return "";
    return response.text();
  }

  private async fetch(path: string, options: RequestOptions): Promise<Response> {
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

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: options.method ?? "GET",
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch {
      throw new SipgateApiError("Could not reach the sipgate API. Check the network connection and try again.");
    }

    if (!response.ok) throw errorForStatus(response.status, response.headers.get("retry-after"));
    return response;
  }
}
