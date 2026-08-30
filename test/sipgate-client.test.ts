import assert from "node:assert/strict";
import test from "node:test";
import { SipgateApiError, SipgateClient } from "../src/backend/sipgate-client.js";

test("SipgateClient sends Basic Auth, query parameters, and JSON bodies", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), ...(init === undefined ? {} : { init }) });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const client = new SipgateClient({
    tokenId: "token-id",
    token: "token-secret",
    fetch: fetchMock,
  });

  await client.request("/history", {
    method: "POST",
    query: { directions: ["INCOMING", "OUTGOING"], limit: 25 },
    body: { value: true },
  });

  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.ok(request);
  assert.equal(
    request.url,
    "https://api.sipgate.com/v2/history?directions=INCOMING&directions=OUTGOING&limit=25",
  );
  const headers = new Headers(request.init?.headers);
  assert.equal(
    headers.get("authorization"),
    `Basic ${Buffer.from("token-id:token-secret").toString("base64")}`,
  );
  assert.equal(request.init?.body, JSON.stringify({ value: true }));
});

test("SipgateClient returns raw export text with the requested Accept header", async () => {
  let headers = new Headers();
  const fetchMock = (async (_input: string | URL | Request, init?: RequestInit) => {
    headers = new Headers(init?.headers);
    return new Response("id,type\nh0,CALL\n", { status: 200 });
  }) as typeof fetch;
  const client = new SipgateClient({ tokenId: "token-id", token: "token-secret", fetch: fetchMock });

  const result = await client.requestText("/history/export", {
    accept: "application/octet-stream",
  });

  assert.equal(result, "id,type\nh0,CALL\n");
  assert.equal(headers.get("accept"), "application/octet-stream");
});

for (const [status, fragment] of [
  [401, "authentication failed"],
  [403, "missing a required PAT scope"],
  [404, "not found"],
  [429, "rate limit exceeded"],
] as const) {
  test(`SipgateClient maps HTTP ${status} without exposing response details`, async () => {
    const fetchMock = (async () => new Response(
      JSON.stringify({ detail: "token-id:token-secret" }),
      { status, ...(status === 429 ? { headers: { "retry-after": "5" } } : {}) },
    )) as typeof fetch;
    const client = new SipgateClient({ tokenId: "token-id", token: "token-secret", fetch: fetchMock });

    await assert.rejects(
      client.request("/account"),
      (error: unknown) => {
        assert.ok(error instanceof SipgateApiError);
        assert.match(error.message, new RegExp(fragment, "i"));
        assert.doesNotMatch(error.message, /token-secret|token-id/);
        return true;
      },
    );
  });
}

test("SipgateClient converts network failures into a credential-safe error", async () => {
  const fetchMock = (async () => {
    throw new Error("request with token-secret failed");
  }) as typeof fetch;
  const client = new SipgateClient({ tokenId: "token-id", token: "token-secret", fetch: fetchMock });

  await assert.rejects(client.request("/account"), (error: unknown) => {
    assert.ok(error instanceof SipgateApiError);
    assert.doesNotMatch(error.message, /token-secret|token-id/);
    return true;
  });
});
