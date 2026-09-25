import { AsyncLocalStorage } from "node:async_hooks";

export interface JournalEntry {
  method: string;
  path: string;
  ok: boolean;
  /** Identifiers from a write's confirmation body, such as a call session ID. */
  identifiers?: Record<string, string | number>;
}

/**
 * Records the sipgate requests made during one tool call, so that a failure
 * after sipgate accepted a write is reported as applied, not as retryable.
 */
export const requestJournal = new AsyncLocalStorage<JournalEntry[]>();
