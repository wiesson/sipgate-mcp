import assert from "node:assert/strict";
import test from "node:test";
import { collectPages, MAX_PAGES, PAGE_SIZE } from "../src/backend/pagination.js";
import { SipgateApiError } from "../src/backend/sipgate-client.js";
import type { JsonObject, JsonValue } from "../src/backend/telephony-backend.js";

const items = (response: JsonValue) =>
  ((response as { items?: JsonObject[] }).items ?? []);

function entries(from: number, count: number): JsonObject[] {
  return Array.from({ length: count }, (_, index) => ({ id: `e${from + index}` }));
}

test("collectPages advances by what a clamping server returned until totalCount", async () => {
  const offsets: number[] = [];
  const result = await collectPages(async (offset) => {
    offsets.push(offset);
    return { items: entries(offset, Math.min(100, 250 - offset)), totalCount: 250 };
  }, items, "numbers");

  assert.deepEqual(offsets, [0, 100, 200]);
  assert.equal(result.length, 250);
});

test("collectPages follows nextOffset when a scoped reader filtered the page", async () => {
  const offsets: number[] = [];
  const result = await collectPages(async (offset) => {
    offsets.push(offset);
    return offset === 0
      ? { items: entries(0, 1), pagination: { totalCount: 1500, nextOffset: PAGE_SIZE } }
      : { items: entries(offset, 1), pagination: { totalCount: 1500, nextOffset: null } };
  }, items, "history entries");

  assert.deepEqual(offsets, [0, PAGE_SIZE]);
  assert.deepEqual(result.map((entry) => entry.id), ["e0", `e${PAGE_SIZE}`]);
});

test("collectPages keeps reading past an empty filtered page while nextOffset continues", async () => {
  const result = await collectPages(async (offset) => offset === 0
    ? { items: [], pagination: { nextOffset: PAGE_SIZE } }
    : { items: entries(offset, 1), pagination: { nextOffset: null } }, items, "history entries");

  assert.equal(result.length, 1);
});

test("collectPages stops on a short page when no totalCount is reported", async () => {
  let calls = 0;
  const result = await collectPages(async (offset) => {
    calls += 1;
    return { items: entries(offset, offset === 0 ? PAGE_SIZE : 3) };
  }, items, "numbers");

  assert.equal(calls, 2);
  assert.equal(result.length, PAGE_SIZE + 3);
});

for (const nextOffset of [0, -5, 1.5, "1000"] as const) {
  test(`collectPages rejects a continuation offset of ${JSON.stringify(nextOffset)}`, async () => {
    let calls = 0;
    await assert.rejects(
      collectPages(async () => {
        calls += 1;
        return { items: entries(0, 1), pagination: { nextOffset } };
      }, items, "history entries"),
      /invalid continuation offset for history entries/,
    );
    assert.equal(calls, 1);
  });
}

test("collectPages gives up on an endpoint that never stops returning full pages", async () => {
  let calls = 0;
  await assert.rejects(
    collectPages(async () => {
      calls += 1;
      return { items: entries(0, PAGE_SIZE) };
    }, items, "numbers"),
    (error: unknown) => {
      assert.ok(error instanceof SipgateApiError);
      assert.match(error.message, /beyond 100 pages/);
      return true;
    },
  );
  assert.equal(calls, MAX_PAGES);
});
