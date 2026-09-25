import { SipgateApiError } from "./sipgate-client.js";
import type { JsonObject, JsonValue } from "./telephony-backend.js";

export const PAGE_SIZE = 1000;
/** Far beyond any real account, but it keeps a misbehaving endpoint finite. */
export const MAX_PAGES = 100;

function asObject(value: JsonValue | undefined): JsonObject | undefined {
  return value && !Array.isArray(value) && typeof value === "object" ? value : undefined;
}

function totalCountOf(response: JsonObject | undefined): number | undefined {
  const count = response?.totalCount ?? asObject(response?.pagination)?.totalCount;
  return typeof count === "number" ? count : undefined;
}

/**
 * Reads every page of an offset-paginated result.
 *
 * A `pagination.nextOffset` in the envelope wins: it is computed from what
 * sipgate returned, so it stays correct when a scoped reader has filtered the
 * page's entries. Otherwise the offset advances by the entries actually
 * received, so a server that clamps `limit` is still read completely whenever
 * it reports `totalCount`. Without either, a short page is taken as the end,
 * which holds as long as the endpoint honours the requested limit.
 */
export async function collectPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<JsonValue>,
  entries: (response: JsonValue) => T[],
  description: string,
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await fetchPage(offset, PAGE_SIZE);
    const found = entries(response);
    all.push(...found);

    const envelope = asObject(response);
    const pagination = asObject(envelope?.pagination);
    if (pagination && "nextOffset" in pagination) {
      const next = pagination.nextOffset;
      // Only an explicit null ends the read; anything else that does not move
      // forward would silently truncate an ownership or deletion set.
      if (next === null) return all;
      if (typeof next !== "number" || !Number.isSafeInteger(next) || next <= offset) {
        throw new SipgateApiError(
          `sipgate returned an invalid continuation offset for ${description}; the read was stopped.`,
        );
      }
      offset = next;
      continue;
    }

    if (found.length === 0) return all;
    offset += found.length;
    const totalCount = totalCountOf(envelope);
    if (totalCount !== undefined ? offset >= totalCount : found.length < PAGE_SIZE) return all;
  }
  throw new SipgateApiError(
    `sipgate kept returning ${description} beyond ${MAX_PAGES} pages; the read was stopped instead of looping.`,
  );
}
