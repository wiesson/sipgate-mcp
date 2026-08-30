import assert from "node:assert/strict";
import test from "node:test";
import { SipgateBackend } from "../src/backend/sipgate-backend.js";
import { SipgateClient } from "../src/backend/sipgate-client.js";
import type { JsonValue, MutationResult } from "../src/backend/telephony-backend.js";

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

const readEndpointCases: Array<{
  name: string;
  path: string;
  run: (backend: SipgateBackend) => Promise<JsonValue>;
}> = [
  {
    name: "list_user_numbers",
    path: "/v2/w0/numbers",
    run: (backend) => backend.getUserNumbers("w0"),
  },
  { name: "get_device", path: "/v2/devices/e0", run: (backend) => backend.getDevice("e0") },
  {
    name: "get_device_caller_id",
    path: "/v2/devices/e0/callerid",
    run: (backend) => backend.getDeviceCallerId("e0"),
  },
  {
    name: "get_device_local_prefix",
    path: "/v2/devices/e0/localprefix",
    run: (backend) => backend.getDeviceLocalPrefix("e0"),
  },
  {
    name: "get_device_tariff_announcement",
    path: "/v2/devices/e0/tariffannouncement",
    run: (backend) => backend.getDeviceTariffAnnouncement("e0"),
  },
  {
    name: "get_device_single_row_display",
    path: "/v2/devices/e0/singlerowdisplay",
    run: (backend) => backend.getDeviceSingleRowDisplay("e0"),
  },
  {
    name: "get_device_contingents",
    path: "/v2/w0/devices/y0/contingents",
    run: (backend) => backend.getDeviceContingents("w0", "y0"),
  },
  { name: "list_addresses", path: "/v2/addresses", run: (backend) => backend.listAddresses() },
  { name: "get_address", path: "/v2/addresses/123", run: (backend) => backend.getAddress(123) },
  {
    name: "list_address_numbers",
    path: "/v2/addresses/123/numbers",
    run: (backend) => backend.listAddressNumbers(123),
  },
  {
    name: "validate_quick_dial",
    path: "/v2/numbers/quickdial/validation/42",
    run: (backend) => backend.validateQuickDialNumber("42"),
  },
  { name: "list_calls", path: "/v2/calls", run: (backend) => backend.listCalls() },
  {
    name: "list_notifications",
    path: "/v2/w0/notifications",
    run: (backend) => backend.listNotifications("w0"),
  },
  {
    name: "list_faxlines",
    path: "/v2/w0/faxlines",
    run: (backend) => backend.listFaxlines("w0"),
  },
  {
    name: "list_faxline_numbers",
    path: "/v2/w0/faxlines/f0/numbers",
    run: (backend) => backend.listFaxlineNumbers("w0", "f0"),
  },
];

for (const endpoint of readEndpointCases) {
  test(`SipgateBackend implements the ${endpoint.name} read endpoint`, async () => {
    const { backend, requests } = backendWithResponses([{ ok: true }]);

    assert.deepEqual(await endpoint.run(backend), { ok: true });
    assert.equal(new URL(requests[0]?.url ?? "").pathname, endpoint.path);
    assert.equal(requests[0]?.method, "GET");
  });
}

const readbackMutationCases: Array<{
  name: string;
  readPath: string;
  writePath: string;
  body: JsonValue;
  run: (backend: SipgateBackend) => Promise<JsonValue>;
}> = [
  {
    name: "update_device",
    readPath: "/v2/devices/e0",
    writePath: "/v2/devices/e0",
    body: { dnd: true, emergencyAddressId: 123 },
    run: (backend) => backend.updateDevice("e0", { dnd: true, emergencyAddressId: 123 }),
  },
  {
    name: "set_device_alias",
    readPath: "/v2/devices/e0",
    writePath: "/v2/devices/e0/alias",
    body: { value: "Desk phone" },
    run: (backend) => backend.setDeviceAlias("e0", "Desk phone"),
  },
  {
    name: "set_device_caller_id",
    readPath: "/v2/devices/e0/callerid",
    writePath: "/v2/devices/e0/callerid",
    body: { value: "+49211123456" },
    run: (backend) => backend.setDeviceCallerId("e0", "+49211123456"),
  },
  {
    name: "set_device_local_prefix",
    readPath: "/v2/devices/e0/localprefix",
    writePath: "/v2/devices/e0/localprefix",
    body: { active: true, value: "0211" },
    run: (backend) => backend.setDeviceLocalPrefix("e0", { active: true, value: "0211" }),
  },
  {
    name: "set_device_tariff_announcement",
    readPath: "/v2/devices/e0/tariffannouncement",
    writePath: "/v2/devices/e0/tariffannouncement",
    body: { enabled: true },
    run: (backend) => backend.setDeviceTariffAnnouncement("e0", true),
  },
  {
    name: "set_device_single_row_display",
    readPath: "/v2/devices/e0/singlerowdisplay",
    writePath: "/v2/devices/e0/singlerowdisplay",
    body: { enabled: true },
    run: (backend) => backend.setDeviceSingleRowDisplay("e0", true),
  },
  {
    name: "set_external_device_target_number",
    readPath: "/v2/devices/x0",
    writePath: "/v2/devices/x0/external/targetnumber",
    body: { number: "+49211234567" },
    run: (backend) => backend.setExternalDeviceTargetNumber("x0", "+49211234567"),
  },
  {
    name: "set_external_device_incoming_call_display",
    readPath: "/v2/devices/x0",
    writePath: "/v2/devices/x0/external/incomingcalldisplay",
    body: { incomingCallDisplay: "CALLER_NUMBER" },
    run: (backend) => backend.setExternalDeviceIncomingCallDisplay("x0", "CALLER_NUMBER"),
  },
  {
    name: "update_address",
    readPath: "/v2/addresses/123",
    writePath: "/v2/addresses/123",
    body: {
      city: "Düsseldorf",
      countrycode: "DE",
      postcode: "40219",
      number: "74",
      street: "Gladbacher Str.",
    },
    run: (backend) => backend.updateAddress(123, {
      city: "Düsseldorf",
      countrycode: "DE",
      postcode: "40219",
      number: "74",
      street: "Gladbacher Str.",
    }),
  },
];

for (const endpoint of readbackMutationCases) {
  test(`SipgateBackend implements the ${endpoint.name} write endpoint with read-back`, async () => {
    const { backend, requests } = backendWithResponses([
      { state: "before" },
      null,
      { state: "after" },
    ]);

    const result = await endpoint.run(backend);

    assert.deepEqual(result, { before: { state: "before" }, after: { state: "after" } });
    assert.deepEqual(requests.map((request) => ({
      method: request.method,
      path: new URL(request.url).pathname,
    })), [
      { method: "GET", path: endpoint.readPath },
      { method: "PUT", path: endpoint.writePath },
      { method: "GET", path: endpoint.readPath },
    ]);
    assert.equal(requests[1]?.body, JSON.stringify(endpoint.body));
  });
}

test("SipgateBackend implements delete_device with a before snapshot and deletion marker", async () => {
  const { backend, requests } = backendWithResponses([{ id: "e0" }, null]);

  const result = await backend.deleteDevice("e0");

  assert.deepEqual(result.before, { id: "e0" });
  assert.equal((result.after as { deleted?: boolean }).deleted, true);
  assert.deepEqual(requests.map((request) => ({
    method: request.method,
    path: new URL(request.url).pathname,
  })), [
    { method: "GET", path: "/v2/devices/e0" },
    { method: "DELETE", path: "/v2/devices/e0" },
  ]);
});

test("SipgateBackend redacts the credential returned by change_device_password", async () => {
  const secret = "new-super-secret-password";
  const { backend, requests } = backendWithResponses([
    { id: "e0", credentials: { username: "user", password: "old-secret" } },
    { password: secret, credential: "another-secret" },
  ]);

  const result = await backend.changeDevicePassword("e0");
  const toolOutput = JSON.stringify(result);

  assert.doesNotMatch(toolOutput, /new-super-secret-password|another-secret|old-secret/);
  assert.match(toolOutput, /\[REDACTED\]/);
  assert.deepEqual(requests.map((request) => ({
    method: request.method,
    path: new URL(request.url).pathname,
  })), [
    { method: "GET", path: "/v2/devices/e0" },
    { method: "POST", path: "/v2/devices/e0/credentials/password" },
  ]);
});

const createDeviceCases: Array<{
  name: string;
  path: string;
  body: JsonValue;
  run: (backend: SipgateBackend) => Promise<MutationResult>;
}> = [
  {
    name: "create_register_device",
    path: "/v2/w0/devices/register",
    body: { alias: "Register" },
    run: (backend) => backend.createRegisterDevice("w0", "Register"),
  },
  {
    name: "create_mobile_device",
    path: "/v2/w0/devices/mobile",
    body: { alias: "Mobile" },
    run: (backend) => backend.createMobileDevice("w0", "Mobile"),
  },
  {
    name: "create_external_device",
    path: "/v2/w0/devices/external",
    body: { alias: "External", number: "+49211234567" },
    run: (backend) => backend.createExternalDevice("w0", "External", "+49211234567"),
  },
];

for (const endpoint of createDeviceCases) {
  test(`SipgateBackend implements ${endpoint.name} with the documented payload`, async () => {
    const { backend, requests } = backendWithResponses([
      { id: "e1", credentials: { password: "must-not-leak" } },
    ]);

    const result = await endpoint.run(backend);

    assert.equal(result.before, null);
    assert.doesNotMatch(JSON.stringify(result), /must-not-leak/);
    assert.equal(requests[0]?.method, "POST");
    assert.equal(new URL(requests[0]?.url ?? "").pathname, endpoint.path);
    assert.equal(requests[0]?.body, JSON.stringify(endpoint.body));
  });
}

test("SipgateBackend implements create_quick_dial with no-read-back semantics", async () => {
  const { backend, requests } = backendWithResponses([null]);

  const result = await backend.createQuickDial({ userId: "w0", number: "42" });

  assert.equal(result.before, null);
  assert.match(JSON.stringify(result.after), /no.*read-back/i);
  assert.equal(new URL(requests[0]?.url ?? "").pathname, "/v2/numbers/quickdial");
  assert.equal(requests[0]?.method, "POST");
  assert.equal(requests[0]?.body, JSON.stringify({ userId: "w0", number: "42" }));
});

test("SipgateBackend implements update_quick_dial with before and after snapshots", async () => {
  const { backend, requests } = backendWithResponses([
    { items: [{ id: "n0", number: "42", type: "QUICKDIAL" }] },
    null,
    { items: [{ id: "n0", number: "43", type: "QUICKDIAL" }] },
  ]);

  const result = await backend.updateQuickDial("n0", { userId: "w0", number: "43" });

  assert.deepEqual(result, {
    before: { id: "n0", number: "42", type: "QUICKDIAL" },
    after: { id: "n0", number: "43", type: "QUICKDIAL" },
  });
  assert.equal(new URL(requests[1]?.url ?? "").pathname, "/v2/numbers/quickdial/n0");
  assert.equal(requests[1]?.method, "PUT");
  assert.equal(requests[1]?.body, JSON.stringify({ userId: "w0", number: "43" }));
});

test("SipgateBackend implements delete_quick_dial with a before snapshot", async () => {
  const { backend, requests } = backendWithResponses([
    { items: [{ id: "n0", number: "42", type: "QUICKDIAL" }] },
    null,
  ]);

  const result = await backend.deleteQuickDial("n0");

  assert.deepEqual(result.before, { id: "n0", number: "42", type: "QUICKDIAL" });
  assert.equal((result.after as { deleted?: boolean }).deleted, true);
  assert.equal(new URL(requests[1]?.url ?? "").pathname, "/v2/numbers/quickdial/n0");
  assert.equal(requests[1]?.method, "DELETE");
});

const notificationMutationCases: Array<{
  name: string;
  path: string;
  body: JsonValue;
  run: (backend: SipgateBackend) => Promise<MutationResult>;
}> = [
  {
    name: "create_call_email_notification",
    path: "/v2/w0/notifications/call/email",
    body: {
      cause: "MISSED",
      direction: "INCOMING",
      email: "me@example.com",
      endpointId: "e0",
    },
    run: (backend) => backend.createCallEmailNotification({
      userId: "w0",
      endpointId: "e0",
      cause: "MISSED",
      direction: "INCOMING",
      email: "me@example.com",
    }),
  },
  {
    name: "create_call_sms_notification",
    path: "/v2/w0/notifications/call/sms",
    body: {
      cause: "SUCCESSFUL",
      direction: "OUTGOING",
      endpointId: "e0",
      number: "+4915799912345",
    },
    run: (backend) => backend.createCallSmsNotification({
      userId: "w0",
      endpointId: "e0",
      cause: "SUCCESSFUL",
      direction: "OUTGOING",
      number: "+4915799912345",
    }),
  },
  {
    name: "create_fax_email_notification",
    path: "/v2/w0/notifications/fax/email",
    body: {
      direction: "INCOMING",
      email: "me@example.com",
      faxlineId: "f0",
    },
    run: (backend) => backend.createFaxEmailNotification({
      userId: "w0",
      faxlineId: "f0",
      direction: "INCOMING",
      email: "me@example.com",
    }),
  },
  {
    name: "create_fax_sms_notification",
    path: "/v2/w0/notifications/fax/sms",
    body: {
      direction: "OUTGOING",
      faxlineId: "f0",
      number: "+4915799912345",
    },
    run: (backend) => backend.createFaxSmsNotification({
      userId: "w0",
      faxlineId: "f0",
      direction: "OUTGOING",
      number: "+4915799912345",
    }),
  },
  {
    name: "create_fax_report_notification",
    path: "/v2/w0/notifications/fax/report",
    body: { email: "me@example.com", faxlineId: "f0" },
    run: (backend) => backend.createFaxReportNotification({
      userId: "w0",
      faxlineId: "f0",
      email: "me@example.com",
    }),
  },
  {
    name: "create_sms_email_notification",
    path: "/v2/w0/notifications/sms/email",
    body: { email: "me@example.com", endpointId: "y0" },
    run: (backend) => backend.createSmsEmailNotification({
      userId: "w0",
      endpointId: "y0",
      email: "me@example.com",
    }),
  },
  {
    name: "create_voicemail_email_notification",
    path: "/v2/w0/notifications/voicemail/email",
    body: { email: "me@example.com", voicemailId: "v0" },
    run: (backend) => backend.createVoicemailEmailNotification({
      userId: "w0",
      voicemailId: "v0",
      email: "me@example.com",
    }),
  },
  {
    name: "create_voicemail_sms_notification",
    path: "/v2/w0/notifications/voicemail/sms",
    body: { number: "+4915799912345", voicemailId: "v0" },
    run: (backend) => backend.createVoicemailSmsNotification({
      userId: "w0",
      voicemailId: "v0",
      number: "+4915799912345",
    }),
  },
];

for (const endpoint of notificationMutationCases) {
  test(`SipgateBackend implements the ${endpoint.name} tool endpoint`, async () => {
    const { backend, requests } = backendWithResponses([
      { call: [], fax: [], sms: [], voicemail: [] },
      null,
      { call: [{ endpointId: "e0" }], fax: [], sms: [], voicemail: [] },
    ]);

    const result = await endpoint.run(backend);

    assert.deepEqual(result.before, { call: [], fax: [], sms: [], voicemail: [] });
    assert.deepEqual(requests.map((request) => ({
      method: request.method,
      path: new URL(request.url).pathname,
    })), [
      { method: "GET", path: "/v2/w0/notifications" },
      { method: "POST", path: endpoint.path },
      { method: "GET", path: "/v2/w0/notifications" },
    ]);
    assert.equal(requests[1]?.body, JSON.stringify(endpoint.body));
  });
}

test("SipgateBackend implements the delete_notification tool endpoint", async () => {
  const before = {
    call: [{ endpointId: "e0", emails: [{ id: "notice0" }] }],
    fax: [],
    sms: [],
    voicemail: [],
  };
  const after = { call: [], fax: [], sms: [], voicemail: [] };
  const { backend, requests } = backendWithResponses([before, null, after]);

  assert.deepEqual(await backend.deleteNotification("w0", "notice0"), { before, after });
  assert.deepEqual(requests.map((request) => ({
    method: request.method,
    path: new URL(request.url).pathname,
  })), [
    { method: "GET", path: "/v2/w0/notifications" },
    { method: "DELETE", path: "/v2/w0/notifications/notice0" },
    { method: "GET", path: "/v2/w0/notifications" },
  ]);
});

const callMutationCases: Array<{
  name: string;
  method: "POST" | "PUT" | "DELETE";
  path: string;
  body?: JsonValue;
  run: (backend: SipgateBackend) => Promise<MutationResult>;
}> = [
  {
    name: "hangup_call",
    method: "DELETE",
    path: "/v2/calls/c0",
    run: (backend) => backend.hangupCall("c0"),
  },
  {
    name: "set_call_hold",
    method: "PUT",
    path: "/v2/calls/c0/hold",
    body: { value: true },
    run: (backend) => backend.setCallHold("c0", true),
  },
  {
    name: "set_call_muted",
    method: "PUT",
    path: "/v2/calls/c0/muted",
    body: { value: false },
    run: (backend) => backend.setCallMuted("c0", false),
  },
  {
    name: "set_call_recording",
    method: "PUT",
    path: "/v2/calls/c0/recording",
    body: { value: true, announcement: false },
    run: (backend) => backend.setCallRecording("c0", true, false),
  },
  {
    name: "transfer_call",
    method: "POST",
    path: "/v2/calls/c0/transfer",
    body: {
      attended: false,
      phoneNumber: "+4915799912345",
      callerId: "+49211123456",
    },
    run: (backend) => backend.transferCall("c0", {
      attended: false,
      phoneNumber: "+4915799912345",
      callerId: "+49211123456",
    }),
  },
  {
    name: "send_call_dtmf",
    method: "POST",
    path: "/v2/calls/c0/dtmf",
    body: { sequence: "123#" },
    run: (backend) => backend.sendCallDtmf("c0", "123#"),
  },
  {
    name: "start_call_announcement",
    method: "POST",
    path: "/v2/calls/c0/announcements",
    body: { url: "https://example.com/announcement.wav" },
    run: (backend) => backend.startCallAnnouncement(
      "c0",
      "https://example.com/announcement.wav",
    ),
  },
];

for (const endpoint of callMutationCases) {
  test(`SipgateBackend implements the ${endpoint.name} tool endpoint`, async () => {
    const before = { callId: "c0", participants: [], recording: false };
    const after = { callId: "c0", participants: [], recording: true };
    const { backend, requests } = backendWithResponses([
      { data: [before] },
      null,
      { data: endpoint.name === "hangup_call" ? [] : [after] },
    ]);

    const result = await endpoint.run(backend);

    assert.deepEqual(result.before, before);
    if (endpoint.name === "hangup_call") {
      assert.equal((result.after as { active?: boolean }).active, false);
    } else {
      assert.deepEqual(result.after, after);
    }
    assert.deepEqual(requests.map((request) => ({
      method: request.method,
      path: new URL(request.url).pathname,
    })), [
      { method: "GET", path: "/v2/calls" },
      { method: endpoint.method, path: endpoint.path },
      { method: "GET", path: "/v2/calls" },
    ]);
    assert.equal(requests[1]?.body, endpoint.body === undefined
      ? undefined
      : JSON.stringify(endpoint.body));
  });
}

test("SipgateBackend implements the send_fax tool endpoint", async () => {
  const { backend, requests } = backendWithResponses([{ sessionId: "fax-session" }]);

  const result = await backend.sendFax({
    faxlineId: "f0",
    recipient: "+4921112345678",
    filename: "fax.pdf",
    base64Content: "cGRm",
  });

  assert.equal(result.before, null);
  assert.match(JSON.stringify(result.after), /charges/);
  assert.equal(requests[0]?.method, "POST");
  assert.equal(new URL(requests[0]?.url ?? "").pathname, "/v2/sessions/fax");
  assert.equal(requests[0]?.body, JSON.stringify({
    base64Content: "cGRm",
    faxlineId: "f0",
    filename: "fax.pdf",
    recipient: "+4921112345678",
  }));
});

test("SipgateBackend implements the resend_fax tool endpoint", async () => {
  const { backend, requests } = backendWithResponses([null]);

  const result = await backend.resendFax({ faxId: "100018428", faxlineId: "f0" });

  assert.equal(result.before, null);
  assert.match(JSON.stringify(result.after), /charges/);
  assert.equal(requests[0]?.method, "POST");
  assert.equal(new URL(requests[0]?.url ?? "").pathname, "/v2/sessions/fax/resend");
  assert.equal(requests[0]?.body, JSON.stringify({ faxId: "100018428", faxlineId: "f0" }));
});

test("SipgateBackend redacts SIM secrets that arrive outside a credentials wrapper", async () => {
  const { backend } = backendWithResponses([
    { id: "y0", puk1: "12345", puk2: "67890", iccid: "8949", simId: "1234567" },
    null,
    { id: "y0" },
  ]);

  const result = await backend.setDnd("y0", true) as { before: Record<string, unknown> };

  assert.equal(result.before.puk1, "[REDACTED]");
  assert.equal(result.before.puk2, "[REDACTED]");
  assert.equal(result.before.iccid, "[REDACTED]");
});
