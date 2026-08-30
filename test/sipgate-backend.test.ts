import assert from "node:assert/strict";
import test from "node:test";
import { SipgateBackend } from "../src/backend/sipgate-backend.js";
import { SipgateClient } from "../src/backend/sipgate-client.js";
import type { JsonValue } from "../src/backend/telephony-backend.js";

interface RecordedRequest {
  url: string;
  method: string;
  body?: string;
}

function backendWithResponses(responses: JsonValue[]): {
  backend: SipgateBackend;
  requests: RecordedRequest[];
} {
  const queue = [...responses];
  const requests: RecordedRequest[] = [];
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
    });
    const value = queue.shift();
    return value === undefined
      ? new Response(null, { status: 204 })
      : new Response(JSON.stringify(value), { status: 200 });
  }) as typeof fetch;
  const client = new SipgateClient({ tokenId: "id", token: "secret", fetch: fetchMock });
  return { backend: new SipgateBackend(client), requests };
}

test("SipgateBackend uses the documented number-routing endpoint and payload", async () => {
  const { backend, requests } = backendWithResponses([
    { items: [{ id: "n0", endpointId: "p0" }] },
    null,
    { items: [{ id: "n0", endpointId: "p1" }] },
  ]);

  const result = await backend.setNumberRouting("n0", "p1");

  assert.deepEqual(result, {
    before: { id: "n0", endpointId: "p0" },
    after: { id: "n0", endpointId: "p1" },
  });
  assert.equal(requests[1]?.url, "https://api.sipgate.com/v2/numbers/n0");
  assert.equal(requests[1]?.method, "PUT");
  assert.equal(requests[1]?.body, JSON.stringify({ endpointId: "p1" }));
});

test("SipgateBackend replaces forwarding rules with the documented wrapper payload", async () => {
  const { backend, requests } = backendWithResponses([
    { items: [] },
    null,
    { items: [{ active: true, destination: "+4915799912345", timeout: 20 }] },
  ]);

  await backend.setForwarding("w0", "p0", [
    { active: true, destination: "+4915799912345", timeout: 20 },
  ]);

  assert.equal(requests[1]?.url, "https://api.sipgate.com/v2/w0/phonelines/p0/forwardings");
  assert.equal(requests[1]?.method, "PUT");
  assert.equal(requests[1]?.body, JSON.stringify({
    forwardings: [{ active: true, destination: "+4915799912345", timeout: 20 }],
  }));
});

test("SipgateBackend verifies an SMS extension before posting the exact SMS payload", async () => {
  const { backend, requests } = backendWithResponses([
    { items: [{ id: "s0", alias: "SMS" }] },
    { items: [] },
    null,
    { items: [{ id: "h1", type: "SMS" }] },
  ]);

  const result = await backend.sendSms({
    userId: "w0",
    recipient: "+4915799912345",
    message: "Hello",
  });

  assert.equal(requests[0]?.url, "https://api.sipgate.com/v2/w0/sms");
  assert.match(requests[1]?.url ?? "", /connectionIds=s0/);
  assert.equal(requests[2]?.url, "https://api.sipgate.com/v2/sessions/sms");
  assert.equal(requests[2]?.body, JSON.stringify({
    smsId: "s0",
    recipient: "+4915799912345",
    message: "Hello",
  }));
  assert.deepEqual(result.after, {
    smsExtension: { id: "s0", alias: "SMS" },
    latestMatchingHistory: { id: "h1", type: "SMS" },
    requestAccepted: true,
  });
  assert.match(requests[3]?.url ?? "", /connectionIds=s0/);
});

test("SipgateBackend never returns device credentials from DND before/after state", async () => {
  const { backend } = backendWithResponses([
    { id: "e0", dnd: false, credentials: { username: "u", password: "p" } },
    null,
    { id: "e0", dnd: true, credentials: { username: "u", password: "p" } },
  ]);

  const result = await backend.setDnd("e0", true);
  assert.deepEqual(result, {
    before: { id: "e0", dnd: false, credentials: "[REDACTED]" },
    after: { id: "e0", dnd: true, credentials: "[REDACTED]" },
  });
});

test("SipgateBackend resolves the authenticated sipgate user", async () => {
  const { backend, requests } = backendWithResponses([{ sub: "w7", locale: "de_DE" }]);

  const result = await backend.getAuthenticatedUser();

  assert.deepEqual(result, {
    identity: { sub: "w7", locale: "de_DE" },
    userId: "w7",
  });
  assert.equal(requests[0]?.url, "https://api.sipgate.com/v2/authorization/userinfo");
});

test("SipgateBackend user routing does not request account-wide numbers or users", async () => {
  const { backend, requests } = backendWithResponses([
    { items: [{ id: "p0", alias: "Personal line" }] },
    { items: [{ id: "n0", number: "+49211123456" }] },
    { items: [] },
  ]);

  const result = await backend.getRouting("w0");

  assert.deepEqual(result, {
    numbers: [{
      id: "n0",
      number: "+49211123456",
      endpointId: "p0",
      endpointAlias: "Personal line",
    }],
    users: [{
      userId: "w0",
      phonelines: [{
        id: "p0",
        alias: "Personal line",
        numbers: [{
          id: "n0",
          number: "+49211123456",
          endpointId: "p0",
          endpointAlias: "Personal line",
        }],
        forwardings: [],
      }],
      phonelinesAvailable: true,
    }],
  });
  assert.deepEqual(requests.map((request) => new URL(request.url).pathname), [
    "/v2/w0/phonelines",
    "/v2/w0/phonelines/p0/numbers",
    "/v2/w0/phonelines/p0/forwardings",
  ]);
});

test("SipgateBackend lists paginated user numbers without reading forwardings", async () => {
  const { backend, requests } = backendWithResponses([
    { items: [{ id: "p0", alias: "Primary" }, { id: "p1", alias: "Secondary" }] },
    { items: [{ id: "n0", number: "+49211123456" }] },
    { items: [{ id: "n1", number: "+49211234567" }] },
  ]);

  const result = await backend.listUserNumbers("w0", { offset: 1, limit: 1 });

  assert.deepEqual(result, {
    items: [{
      id: "n1",
      number: "+49211234567",
      endpointId: "p1",
      endpointAlias: "Secondary",
    }],
    pagination: { offset: 1, limit: 1, returned: 1, totalCount: 2 },
  });
  assert.deepEqual(requests.map((request) => new URL(request.url).pathname), [
    "/v2/w0/phonelines",
    "/v2/w0/phonelines/p0/numbers",
    "/v2/w0/phonelines/p1/numbers",
  ]);
});

test("SipgateBackend changes user-owned number routing without account-wide reads", async () => {
  const { backend, requests } = backendWithResponses([
    { items: [{ id: "p0", alias: "Before" }] },
    { items: [{ id: "n0", number: "+49211123456" }] },
    null,
    { items: [{ id: "p1", alias: "After" }] },
    { items: [{ id: "n0", number: "+49211123456" }] },
  ]);

  const result = await backend.setUserNumberRouting("w0", "n0", "p1");

  assert.deepEqual(result, {
    before: {
      id: "n0",
      number: "+49211123456",
      endpointId: "p0",
      endpointAlias: "Before",
    },
    after: {
      id: "n0",
      number: "+49211123456",
      endpointId: "p1",
      endpointAlias: "After",
    },
  });
  assert.deepEqual(requests.map((request) => ({
    method: request.method,
    path: new URL(request.url).pathname,
  })), [
    { method: "GET", path: "/v2/w0/phonelines" },
    { method: "GET", path: "/v2/w0/phonelines/p0/numbers" },
    { method: "PUT", path: "/v2/numbers/n0" },
    { method: "GET", path: "/v2/w0/phonelines" },
    { method: "GET", path: "/v2/w0/phonelines/p1/numbers" },
  ]);
});

test("SipgateBackend user Click2Dial does not read account-wide active calls", async () => {
  const { backend, requests } = backendWithResponses([{ sessionId: "abc" }]);

  const result = await backend.initiateUserCall({
    caller: "e0",
    callee: "+4915799912345",
  });

  assert.deepEqual(result, {
    before: null,
    after: {
      session: { sessionId: "abc" },
      requestAccepted: true,
      note: "User scope does not read the account-wide active-calls endpoint before or after Click2Dial.",
    },
  });
  assert.deepEqual(requests.map((request) => ({
    method: request.method,
    path: new URL(request.url).pathname,
  })), [{ method: "POST", path: "/v2/sessions/calls" }]);
});

interface StubResponse {
  status?: number;
  body?: JsonValue;
}

function backendWithStatuses(responses: StubResponse[]): {
  backend: SipgateBackend;
  requests: RecordedRequest[];
} {
  const queue = [...responses];
  const requests: RecordedRequest[] = [];
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), method: init?.method ?? "GET" });
    const next = queue.shift() ?? {};
    const status = next.status ?? 200;
    if (status >= 400) return new Response(null, { status });
    return new Response(JSON.stringify(next.body ?? null), { status });
  }) as typeof fetch;
  const client = new SipgateClient({ tokenId: "id", token: "secret", fetch: fetchMock });
  return { backend: new SipgateBackend(client), requests };
}

test("SipgateBackend serves user numbers from devices when phonelines are unavailable", async () => {
  const { backend, requests } = backendWithStatuses([
    { status: 403 },
    { body: { items: [{ id: "e0", alias: "VoIP" }] } },
    {
      body: {
        items: [
          { id: "n0", number: "+49211123456", endpointId: "e0" },
          { id: "n1", number: "+49211234567", endpointId: "e0" },
          { id: "n2", number: "+49211999999", endpointId: "e9" },
        ],
      },
    },
  ]);

  const result = await backend.listUserNumbers("w0", { offset: 0, limit: 10 });

  assert.deepEqual(result, {
    items: [
      { id: "n0", number: "+49211123456", endpointId: "e0" },
      { id: "n1", number: "+49211234567", endpointId: "e0" },
    ],
    pagination: { offset: 0, limit: 10, returned: 2, totalCount: 2 },
    source: "devices",
    phonelinesAvailable: false,
  });
  assert.deepEqual(requests.map((request) => new URL(request.url).pathname), [
    "/v2/w0/phonelines",
    "/v2/w0/devices",
    "/v2/numbers",
  ]);
});

test("SipgateBackend reports phonelines as unavailable instead of failing", async () => {
  const { backend } = backendWithStatuses([{ status: 403 }]);

  assert.deepEqual(await backend.listPhonelines("w0"), {
    items: [],
    phonelinesAvailable: false,
  });
});

test("SipgateBackend still surfaces non-feature errors from phonelines", async () => {
  const { backend } = backendWithStatuses([{ status: 500 }]);

  await assert.rejects(backend.listPhonelines("w0"), /HTTP 500/);
});

test("SipgateBackend returns settings when the account has no phoneline layer", async () => {
  const { backend } = backendWithStatuses([
    { body: { id: "w0", busyOnBusy: false, defaultDevice: "e0" } },
    { body: { items: [{ id: "e0", alias: "VoIP", dnd: false }] } },
    { status: 403 },
  ]);

  const result = await backend.getSettings("w0") as {
    users: { phonelines: JsonValue[]; phonelinesAvailable: boolean }[];
  };

  assert.equal(result.users.length, 1);
  assert.deepEqual(result.users[0]?.phonelines, []);
  assert.equal(result.users[0]?.phonelinesAvailable, false);
});

test("SipgateBackend falls back to device numbers for routing without phonelines", async () => {
  const { backend } = backendWithStatuses([
    { status: 403 },
    { status: 403 },
    { body: { items: [{ id: "e0" }] } },
    { body: { items: [{ id: "n0", number: "+49211123456", endpointId: "e0" }] } },
  ]);

  const result = await backend.getRouting("w0") as {
    numbers: JsonValue[];
    users: { phonelinesAvailable: boolean }[];
  };

  assert.deepEqual(result.numbers, [{ id: "n0", number: "+49211123456", endpointId: "e0" }]);
  assert.equal(result.users[0]?.phonelinesAvailable, false);
});

test("SipgateBackend surfaces a denied numbers endpoint instead of returning nothing", async () => {
  const { backend } = backendWithStatuses([
    { status: 403 },
    { body: { items: [{ id: "e0" }] } },
    { status: 403 },
  ]);

  await assert.rejects(backend.listUserNumbers("w0", { offset: 0, limit: 10 }), /HTTP 403/);
});

test("SipgateBackend reads every page of account numbers for the device fallback", async () => {
  const firstPage = Array.from({ length: 1000 }, (_, index) => ({
    id: `n${index}`,
    number: `+4921100${index}`,
    endpointId: "e0",
  }));
  const { backend, requests } = backendWithStatuses([
    { status: 403 },
    { body: { items: [{ id: "e0" }] } },
    { body: { items: firstPage, totalCount: 1001 } },
    { body: { items: [{ id: "n1000", number: "+49211001000", endpointId: "e0" }], totalCount: 1001 } },
  ]);

  const result = await backend.listUserNumbers("w0", { offset: 1000, limit: 10 }) as {
    items: JsonValue[];
    pagination: { totalCount: number };
  };

  assert.equal(result.pagination.totalCount, 1001);
  assert.deepEqual(result.items, [{ id: "n1000", number: "+49211001000", endpointId: "e0" }]);
  const numberRequests = requests
    .map((request) => new URL(request.url))
    .filter((url) => url.pathname === "/v2/numbers")
    .map((url) => url.searchParams.get("offset"));
  assert.deepEqual(numberRequests, ["0", "1000"]);
});
