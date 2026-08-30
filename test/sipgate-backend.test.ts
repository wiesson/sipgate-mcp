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
      : typeof value === "string"
        ? new Response(value, { status: 200 })
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

test("SipgateBackend reports a specific phoneline tool as unavailable on HTTP 403", async () => {
  const { backend } = backendWithStatuses([{ status: 403 }]);

  assert.deepEqual(await backend.getPhoneline("w0", "p0"), {
    phonelinesAvailable: false,
    httpStatus: 403,
    note: "sipgate denied access to the phoneline feature (HTTP 403). Either this account does not provide it, or the Personal Access Token lacks the scope for it.",
  });
});

test("SipgateBackend does not attempt a phoneline mutation when its read is unavailable", async () => {
  const { backend, requests } = backendWithStatuses([{ status: 403 }]);

  assert.deepEqual(await backend.updatePhonelineAlias("w0", "p0", "Office"), {
    before: null,
    after: {
      changed: false,
      phonelinesAvailable: false,
      httpStatus: 403,
      note: "sipgate denied access to the phoneline feature (HTTP 403). Either this account does not provide it, or the Personal Access Token lacks the scope for it. No change was attempted.",
    },
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.method, "GET");
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
  {
    name: "get_phoneline",
    path: "/v2/w0/phonelines/p0",
    run: (backend) => backend.getPhoneline("w0", "p0"),
  },
  {
    name: "get_phoneline_block_anonymous",
    path: "/v2/w0/phonelines/p0/blockanonymous",
    run: (backend) => backend.getPhonelineBlockAnonymous("w0", "p0"),
  },
  {
    name: "list_phoneline_devices",
    path: "/v2/w0/phonelines/p0/devices",
    run: (backend) => backend.listPhonelineDevices("w0", "p0"),
  },
  {
    name: "list_parallel_forwardings",
    path: "/v2/w0/phonelines/p0/parallelforwardings",
    run: (backend) => backend.listParallelForwardings("w0", "p0"),
  },
  {
    name: "list_phoneline_voicemails",
    path: "/v2/w0/phonelines/p0/voicemails",
    run: (backend) => backend.listPhonelineVoicemails("w0", "p0"),
  },
  {
    name: "list_voicemail_greetings",
    path: "/v2/w0/phonelines/p0/voicemails/v0/greetings",
    run: (backend) => backend.listVoicemailGreetings("w0", "p0", "v0"),
  },
  { name: "list_voicemails", path: "/v2/voicemails", run: (backend) => backend.listVoicemails() },
  {
    name: "get_voicemail",
    path: "/v2/voicemails/v0",
    run: (backend) => backend.getVoicemail("v0"),
  },
  {
    name: "list_autorecording_greetings",
    path: "/v2/autorecordings/greetings",
    run: (backend) => backend.listAutorecordingGreetings(),
  },
  {
    name: "get_autorecording_settings",
    path: "/v2/autorecordings/p0/settings",
    run: (backend) => backend.getAutorecordingSettings("p0"),
  },
  {
    name: "get_faxline_caller_id",
    path: "/v2/w0/faxlines/f0/callerid",
    run: (backend) => backend.getFaxlineCallerId("w0", "f0"),
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
  writeMethod?: "POST" | "PUT" | "DELETE";
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
  {
    name: "update_phoneline_alias",
    readPath: "/v2/w0/phonelines/p0",
    writePath: "/v2/w0/phonelines/p0",
    body: { alias: "Office" },
    run: (backend) => backend.updatePhonelineAlias("w0", "p0", "Office"),
  },
  {
    name: "set_phoneline_block_anonymous",
    readPath: "/v2/w0/phonelines/p0/blockanonymous",
    writePath: "/v2/w0/phonelines/p0/blockanonymous",
    body: { enabled: true, target: "VOICEMAIL" },
    run: (backend) => backend.setPhonelineBlockAnonymous(
      "w0",
      "p0",
      { enabled: true, target: "VOICEMAIL" },
    ),
  },
  {
    name: "attach_device_to_phoneline",
    readPath: "/v2/w0/phonelines/p0/devices",
    writePath: "/v2/w0/phonelines/p0/devices",
    writeMethod: "POST",
    body: { deviceId: "e0" },
    run: (backend) => backend.attachDeviceToPhoneline("w0", "p0", "e0"),
  },
  {
    name: "detach_device_from_phoneline",
    readPath: "/v2/w0/phonelines/p0/devices",
    writePath: "/v2/w0/phonelines/p0/devices/e0",
    writeMethod: "DELETE",
    body: null,
    run: (backend) => backend.detachDeviceFromPhoneline("w0", "p0", "e0"),
  },
  {
    name: "create_parallel_forwarding",
    readPath: "/v2/w0/phonelines/p0/parallelforwardings",
    writePath: "/v2/w0/phonelines/p0/parallelforwardings",
    writeMethod: "POST",
    body: { active: true, alias: "Mobile", destination: "+4915799912345" },
    run: (backend) => backend.createParallelForwarding("w0", "p0", {
      active: true,
      alias: "Mobile",
      destination: "+4915799912345",
    }),
  },
  {
    name: "update_parallel_forwarding",
    readPath: "/v2/w0/phonelines/p0/parallelforwardings",
    writePath: "/v2/w0/phonelines/p0/parallelforwardings/x0",
    body: { active: false },
    run: (backend) => backend.updateParallelForwarding("w0", "p0", "x0", { active: false }),
  },
  {
    name: "delete_parallel_forwarding",
    readPath: "/v2/w0/phonelines/p0/parallelforwardings",
    writePath: "/v2/w0/phonelines/p0/parallelforwardings/x0",
    writeMethod: "DELETE",
    body: null,
    run: (backend) => backend.deleteParallelForwarding("w0", "p0", "x0"),
  },
  {
    name: "update_voicemail",
    readPath: "/v2/w0/phonelines/p0/voicemails",
    writePath: "/v2/w0/phonelines/p0/voicemails/v0",
    body: { active: true, transcription: false, timeout: 20 },
    run: (backend) => backend.updateVoicemail("w0", "p0", "v0", {
      active: true,
      transcription: false,
      timeout: 20,
    }),
  },
  {
    name: "create_voicemail_greeting",
    readPath: "/v2/w0/phonelines/p0/voicemails/v0/greetings",
    writePath: "/v2/w0/phonelines/p0/voicemails/v0/greetings",
    writeMethod: "POST",
    body: { base64Content: "YWJj", filename: "greeting.mp3" },
    run: (backend) => backend.createVoicemailGreeting("w0", "p0", "v0", {
      base64Content: "YWJj",
      filename: "greeting.mp3",
    }),
  },
  {
    name: "update_voicemail_greeting",
    readPath: "/v2/w0/phonelines/p0/voicemails/v0/greetings",
    writePath: "/v2/w0/phonelines/p0/voicemails/v0/greetings/g0",
    body: { active: true },
    run: (backend) => backend.updateVoicemailGreeting("w0", "p0", "v0", "g0", true),
  },
  {
    name: "delete_voicemail_greeting",
    readPath: "/v2/w0/phonelines/p0/voicemails/v0/greetings",
    writePath: "/v2/w0/phonelines/p0/voicemails/v0/greetings/g0",
    writeMethod: "DELETE",
    body: null,
    run: (backend) => backend.deleteVoicemailGreeting("w0", "p0", "v0", "g0"),
  },
  {
    name: "set_voicemail_transcription",
    readPath: "/v2/w0/phonelines/p0/voicemails",
    writePath: "/v2/w0/phonelines/p0/voicemails/v0/transcriptions",
    body: { active: true },
    run: (backend) => backend.setVoicemailTranscription("w0", "p0", "v0", true),
  },
  {
    name: "create_autorecording_greeting",
    readPath: "/v2/autorecordings/greetings",
    writePath: "/v2/autorecordings/greetings",
    writeMethod: "POST",
    body: { base64Content: "YWJj", filename: "notice.mp3" },
    run: (backend) => backend.createAutorecordingGreeting({
      base64Content: "YWJj",
      filename: "notice.mp3",
    }),
  },
  {
    name: "set_autorecording_settings",
    readPath: "/v2/autorecordings/p0/settings",
    writePath: "/v2/autorecordings/p0/settings",
    body: { active: true },
    run: (backend) => backend.setAutorecordingSettings("p0", true),
  },
  {
    name: "set_faxline_caller_id",
    readPath: "/v2/w0/faxlines/f0/callerid",
    writePath: "/v2/w0/faxlines/f0/callerid",
    body: { value: "+49211123456" },
    run: (backend) => backend.setFaxlineCallerId("w0", "f0", "+49211123456"),
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
      { method: endpoint.writeMethod ?? "PUT", path: endpoint.writePath },
      { method: "GET", path: endpoint.readPath },
    ]);
    assert.equal(
      requests[1]?.body,
      endpoint.body === null ? undefined : JSON.stringify(endpoint.body),
    );
  });
}

const noReadbackMutationCases: Array<{
  name: string;
  path: string;
  body?: JsonValue;
  run: (backend: SipgateBackend) => Promise<MutationResult>;
}> = [
  {
    name: "create_phoneline",
    path: "/v2/w0/phonelines",
    run: (backend) => backend.createPhoneline("w0"),
  },
  {
    name: "play_voicemail",
    path: "/v2/sessions/voicemail/play",
    body: { datadId: "1000171", deviceId: "e0" },
    run: (backend) => backend.playVoicemail({ dataId: "1000171", deviceId: "e0" }),
  },
  {
    name: "record_voicemail_greeting",
    path: "/v2/sessions/voicemail/recording",
    body: { deviceId: "e0", endpoint: "MAIN", targetId: "v0" },
    run: (backend) => backend.recordVoicemailGreeting({
      deviceId: "e0",
      endpoint: "MAIN",
      targetId: "v0",
    }),
  },
  {
    name: "create_faxline",
    path: "/v2/w0/faxlines",
    run: (backend) => backend.createFaxline("w0"),
  },
];

for (const endpoint of noReadbackMutationCases) {
  test(`SipgateBackend implements ${endpoint.name} with documented no-read-back semantics`, async () => {
    const { backend, requests } = backendWithResponses([{ id: "created" }]);

    const result = await endpoint.run(backend);

    assert.equal(result.before, null);
    assert.equal(requests[0]?.method, "POST");
    assert.equal(new URL(requests[0]?.url ?? "").pathname, endpoint.path);
    assert.equal(
      requests[0]?.body,
      endpoint.body === undefined ? undefined : JSON.stringify(endpoint.body),
    );
  });
}

const deleteConfigurationCases: Array<{
  name: string;
  readResponse: JsonValue;
  readPath: string;
  deletePath: string;
  run: (backend: SipgateBackend) => Promise<MutationResult>;
}> = [
  {
    name: "delete_phoneline",
    readResponse: { id: "p0" },
    readPath: "/v2/w0/phonelines/p0",
    deletePath: "/v2/w0/phonelines/p0",
    run: (backend) => backend.deletePhoneline("w0", "p0"),
  },
  {
    name: "delete_autorecording_greeting",
    readResponse: { id: "ag0" },
    readPath: "/v2/autorecordings/greetings",
    deletePath: "/v2/autorecordings/greetings/ag0",
    run: (backend) => backend.deleteAutorecordingGreeting("ag0"),
  },
  {
    name: "delete_faxline",
    readResponse: { items: [{ id: "f0", alias: "Fax" }] },
    readPath: "/v2/w0/faxlines",
    deletePath: "/v2/w0/faxlines/f0",
    run: (backend) => backend.deleteFaxline("w0", "f0"),
  },
];

for (const endpoint of deleteConfigurationCases) {
  test(`SipgateBackend implements ${endpoint.name} with a before snapshot`, async () => {
    const { backend, requests } = backendWithResponses([endpoint.readResponse, null]);

    const result = await endpoint.run(backend);

    assert.equal((result.after as { deleted?: boolean }).deleted, true);
    assert.deepEqual(requests.map((request) => ({
      method: request.method,
      path: new URL(request.url).pathname,
    })), [
      { method: "GET", path: endpoint.readPath },
      { method: "DELETE", path: endpoint.deletePath },
    ]);
  });
}

for (const endpoint of [
  {
    name: "update_faxline_alias",
    path: "/v2/w0/faxlines/f0",
    body: { alias: "Office fax" },
    run: (backend: SipgateBackend) => backend.updateFaxlineAlias("w0", "f0", "Office fax"),
  },
  {
    name: "set_faxline_tagline",
    path: "/v2/w0/faxlines/f0/tagline",
    body: { value: "Example Ltd." },
    run: (backend: SipgateBackend) => backend.setFaxlineTagline("w0", "f0", "Example Ltd."),
  },
]) {
  test(`SipgateBackend implements ${endpoint.name} with faxline read-back`, async () => {
    const { backend, requests } = backendWithResponses([
      { items: [{ id: "f0", alias: "Before" }] },
      null,
      { items: [{ id: "f0", alias: "After" }] },
    ]);

    assert.deepEqual(await endpoint.run(backend), {
      before: { id: "f0", alias: "Before" },
      after: { id: "f0", alias: "After" },
    });
    assert.deepEqual(requests.map((request) => ({
      method: request.method,
      path: new URL(request.url).pathname,
    })), [
      { method: "GET", path: "/v2/w0/faxlines" },
      { method: "PUT", path: endpoint.path },
      { method: "GET", path: "/v2/w0/faxlines" },
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

test("SipgateBackend says a phoneline change was applied when only the read-back is denied", async () => {
  const { backend } = backendWithStatuses([
    { body: { id: "p0", alias: "Old" } },
    { body: null },
    { status: 403 },
  ]);

  const result = await backend.updatePhonelineAlias("w0", "p0", "Office") as {
    after: Record<string, unknown>;
  };

  assert.equal(result.after.changed, true);
  assert.match(String(result.after.note), /change was applied/);
});

test("SipgateBackend refuses to delete a recording greeting that is not the configured one", async () => {
  const { backend, requests } = backendWithStatuses([
    { body: { id: "g0", greetingUrl: "https://example.com/g0.wav" } },
  ]);

  await assert.rejects(backend.deleteAutorecordingGreeting("g9"), /not the one currently configured/);
  assert.equal(requests.length, 1);
});

const finalBatchReadCases: Array<{
  name: string;
  response: JsonValue;
  execute: (backend: SipgateBackend) => Promise<JsonValue>;
  path: string;
  query?: string;
}> = [
  {
    name: "list_contacts",
    response: { items: [] },
    execute: (backend) => backend.listContacts({
      phoneNumbers: ["+49211123456"],
      limit: 25,
      lastId: "c0",
      scopes: ["PRIVATE"],
    }),
    path: "/v2/contacts",
    query: "phonenumbers=%2B49211123456&limit=25&lastId=c0&scopes=PRIVATE",
  },
  {
    name: "get_contact",
    response: { id: "contact 1" },
    execute: (backend) => backend.getContact("contact 1"),
    path: "/v2/contacts/contact%201",
  },
  {
    name: "list_internal_contacts",
    response: { items: [] },
    execute: (backend) => backend.listInternalContacts(),
    path: "/v2/contacts/internal",
  },
  {
    name: "export_contacts_csv",
    response: "firstname,lastname,number\nAda,Lovelace,+4915799912345\n",
    execute: (backend) => backend.exportContactsCsv(["PRIVATE", "SHARED"]),
    path: "/v2/contacts/csv",
    query: "scope=PRIVATE&scope=SHARED",
  },
  {
    name: "get_contacts_vcard",
    response: { contacts: [] },
    execute: (backend) => backend.getContactsVcard({
      scopes: ["PRIVATE"],
      contactIds: ["c0"],
      wantedFields: ["FN"],
      limit: 50,
    }),
    path: "/v2/contacts/vcard",
    query: "scope=PRIVATE&contactIds=c0&wantedFields=FN&limit=50",
  },
  {
    name: "list_incoming_blacklist",
    response: { items: [] },
    execute: (backend) => backend.listIncomingBlacklist(),
    path: "/v2/blacklist/incoming",
  },
  {
    name: "list_call_restrictions",
    response: { userId: "w0", roaming: false },
    execute: (backend) => backend.getCallRestrictions(["w0"]),
    path: "/v2/callrestrictions",
    query: "userIds=w0",
  },
  {
    name: "list_restrictions",
    response: { items: [] },
    execute: (backend) => backend.getRestrictions("w0", ["CAN_GET_BLACKLIST"]),
    path: "/v2/restrictions",
    query: "userId=w0&restriction=CAN_GET_BLACKLIST",
  },
  {
    name: "export_history",
    response: "id,type\nh0,CALL\n",
    execute: (backend) => backend.exportHistory({
      connectionIds: ["e0"],
      types: ["CALL"],
      directions: ["OUTGOING"],
      offset: 0,
      limit: 100,
      archived: false,
      starred: ["STARRED"],
      from: "2026-01-01T00:00:00Z",
      to: "2026-01-31T23:59:59Z",
    }),
    path: "/v2/history/export",
    query: "connectionIds=e0&types=CALL&directions=OUTGOING&offset=0&limit=100&archived=false&starred=STARRED&from=2026-01-01T00%3A00%3A00Z&to=2026-01-31T23%3A59%3A59Z",
  },
  {
    name: "get_balance",
    response: { amount: 35000, currency: "EUR" },
    execute: (backend) => backend.getBalance(),
    path: "/v2/balance",
  },
  {
    name: "list_portings",
    response: { items: [] },
    execute: (backend) => backend.listPortings(),
    path: "/v2/portings",
  },
  {
    name: "get_porting",
    response: { id: "17" },
    execute: (backend) => backend.getPorting(17),
    path: "/v2/portings/17",
  },
  {
    name: "get_sipgateio_settings",
    response: { incomingUrl: "https://example.com/in" },
    execute: (backend) => backend.getSipgateIoSettings(),
    path: "/v2/settings/sipgateio",
  },
  {
    name: "list_webhook_logs",
    response: { items: [] },
    execute: (backend) => backend.listWebhookLogs(),
    path: "/v2/log/webhooks",
  },
];

for (const readCase of finalBatchReadCases) {
  test(`SipgateBackend implements the ${readCase.name} tool endpoint`, async () => {
    const { backend, requests } = backendWithResponses([readCase.response]);
    await readCase.execute(backend);
    const url = new URL(requests[0]?.url ?? "");
    assert.equal(requests[0]?.method, "GET");
    assert.equal(url.pathname, readCase.path);
    assert.equal(url.searchParams.toString(), readCase.query ?? "");
  });
}

test("SipgateBackend implements the create_contact tool endpoint", async () => {
  const { backend, requests } = backendWithResponses([null]);
  const result = await backend.createContact({ name: "Ada", scope: "SHARED" }, true);
  assert.equal(result.before, null);
  assert.equal(requests[0]?.method, "POST");
  assert.equal(new URL(requests[0]?.url ?? "").pathname, "/v2/contacts");
  assert.equal(requests[0]?.body, JSON.stringify({ name: "Ada", scope: "SHARED" }));
});

test("SipgateBackend implements the update_contact tool endpoint", async () => {
  const { backend, requests } = backendWithResponses([
    { id: "c0", name: "Ada" },
    null,
    { id: "c0", name: "Ada Lovelace" },
  ]);
  const result = await backend.updateContact("c0", { id: "c0", name: "Ada Lovelace" }, true);
  assert.deepEqual(result.after, { id: "c0", name: "Ada Lovelace" });
  assert.equal(requests[1]?.method, "PUT");
  assert.equal(requests[1]?.body, JSON.stringify({ id: "c0", name: "Ada Lovelace" }));
});

test("SipgateBackend implements the delete_contact tool endpoint", async () => {
  const { backend, requests } = backendWithResponses([{ id: "c0" }, { deleted: true }]);
  const result = await backend.deleteContact("c0", ["PRIVATE"], true);
  assert.deepEqual(result.before, { id: "c0" });
  assert.equal(requests[1]?.method, "DELETE");
  assert.equal(new URL(requests[1]?.url ?? "").searchParams.toString(), "scope=PRIVATE");
});

test("SipgateBackend implements the delete_contacts tool endpoint", async () => {
  const { backend, requests } = backendWithResponses([{ id: "c0" }, { deleted: ["c0"] }]);
  const result = await backend.deleteContacts({ contactIds: ["c0"], scope: ["PRIVATE"] }, true);
  assert.deepEqual(result.before, [{ id: "c0" }]);
  assert.equal(requests[1]?.method, "DELETE");
  assert.equal(requests[1]?.body, JSON.stringify({ contactIds: ["c0"], scope: ["PRIVATE"] }));
});

test("SipgateBackend implements the import_contacts_csv tool endpoint", async () => {
  const { backend, requests } = backendWithResponses([
    { items: [{ id: "c0" }] },
    null,
    { items: [{ id: "c0" }, { id: "c1" }] },
  ]);
  const result = await backend.importContactsCsv("Zmlyc3RuYW1l", true);
  assert.deepEqual(result.before, { items: [{ id: "c0" }], totalCount: 1 });
  assert.deepEqual(result.after, { items: [{ id: "c0" }, { id: "c1" }], totalCount: 2 });
  assert.equal(requests[1]?.method, "POST");
  assert.equal(requests[1]?.body, JSON.stringify({ base64Content: "Zmlyc3RuYW1l" }));
});

test("SipgateBackend implements the put_contacts_vcard tool endpoint", async () => {
  const data = [{ contactId: "c0", item: { FN: [{ value: "Ada" }] } }];
  const { backend, requests } = backendWithResponses([
    { contacts: [{ meta: { UUID: "c0" } }] },
    { result: [{ contactId: "c0" }] },
    { contacts: [{ meta: { UUID: "c0" }, items: { FN: [{ value: "Ada" }] } }] },
  ]);
  const result = await backend.putContactsVcard("PRIVATE", data, true);
  assert.notDeepEqual(result.before, result.after);
  assert.equal(requests[1]?.method, "PUT");
  assert.equal(new URL(requests[1]?.url ?? "").searchParams.toString(), "scope=PRIVATE");
  assert.equal(requests[1]?.body, JSON.stringify({ data }));
});

test("SipgateBackend implements the add_incoming_blacklist tool endpoint", async () => {
  const { backend, requests } = backendWithResponses([
    { items: [] },
    { phoneNumber: "+49211123456", isBlock: true },
    { items: [{ phoneNumber: "+49211123456", isBlock: true }] },
  ]);
  const result = await backend.addIncomingBlacklist("49211123456", true, true);
  assert.deepEqual(result.before, { items: [] });
  assert.equal(requests[1]?.method, "POST");
  assert.equal(requests[1]?.body, JSON.stringify({ phoneNumber: "49211123456", isBlock: true }));
});

test("SipgateBackend implements the remove_incoming_blacklist tool endpoint", async () => {
  const { backend, requests } = backendWithResponses([
    { items: [{ phoneNumber: "+49211123456", isBlock: false }] },
    null,
  ]);
  const result = await backend.removeIncomingBlacklist("+49211123456", true);
  assert.deepEqual(result.before, { phoneNumber: "+49211123456", isBlock: false });
  assert.equal(requests[1]?.method, "DELETE");
  assert.equal(new URL(requests[1]?.url ?? "").pathname, "/v2/blacklist/incoming/%2B49211123456");
});

test("SipgateBackend implements the set_call_restriction tool endpoint", async () => {
  const { backend, requests } = backendWithResponses([
    { sub: "w0" },
    { userId: "w0", roaming: false },
    { userId: "w0", roaming: true },
    { userId: "w0", roaming: true },
  ]);
  const result = await backend.setCallRestriction("roaming", true);
  assert.deepEqual(result.before, { userId: "w0", roaming: false });
  assert.deepEqual(result.after, { userId: "w0", roaming: true });
  assert.equal(requests[2]?.method, "POST");
  assert.equal(new URL(requests[2]?.url ?? "").pathname, "/v2/w0/callrestrictions/roaming");
  assert.equal(requests[2]?.body, JSON.stringify({ enabled: true }));
});

const historyPropertyCases: Array<{
  name: string;
  execute: (backend: SipgateBackend) => Promise<MutationResult>;
  suffix: string;
  body: JsonValue;
}> = [
  { name: "set_history_read", execute: (backend) => backend.setHistoryRead("h0", true), suffix: "/read", body: { value: true } },
  { name: "set_history_note", execute: (backend) => backend.setHistoryNote("h0", "Note"), suffix: "/note", body: { note: "Note" } },
  { name: "set_history_archive", execute: (backend) => backend.setHistoryArchive("h0", true), suffix: "/archive", body: { value: true } },
];

for (const historyCase of historyPropertyCases) {
  test(`SipgateBackend implements the ${historyCase.name} tool endpoint`, async () => {
    const { backend, requests } = backendWithResponses([
      { id: "h0", read: false },
      null,
      { id: "h0", read: true },
    ]);
    const result = await historyCase.execute(backend);
    assert.deepEqual(result.before, { id: "h0", read: false });
    assert.equal(requests[1]?.method, "PUT");
    assert.equal(new URL(requests[1]?.url ?? "").pathname, `/v2/history/h0${historyCase.suffix}`);
    assert.equal(requests[1]?.body, JSON.stringify(historyCase.body));
  });
}

test("SipgateBackend implements the update_history_entry tool endpoint", async () => {
  const { backend, requests } = backendWithResponses([
    { id: "h0", starred: false },
    null,
    { id: "h0", starred: true },
  ]);
  const result = await backend.updateHistoryEntry("h0", { note: "Note", starred: true });
  assert.deepEqual(result.after, { id: "h0", starred: true });
  assert.equal(requests[1]?.method, "PUT");
  assert.equal(requests[1]?.body, JSON.stringify({ note: "Note", starred: true }));
});

test("SipgateBackend implements the delete_history_entry tool endpoint", async () => {
  const { backend, requests } = backendWithResponses([{ id: "h0" }, null]);
  const result = await backend.deleteHistoryEntry("h0");
  assert.deepEqual(result.before, { id: "h0" });
  assert.equal(requests[1]?.method, "DELETE");
  assert.equal(new URL(requests[1]?.url ?? "").pathname, "/v2/history/h0");
});

test("SipgateBackend implements the update_history_entries tool endpoint", async () => {
  const { backend, requests } = backendWithResponses([
    { id: "h0", read: false },
    null,
    { id: "h0", read: true },
  ]);
  const result = await backend.updateHistoryEntries([{ id: "h0", read: true }]);
  assert.deepEqual(result.before, [{ id: "h0", read: false }]);
  assert.deepEqual(result.after, [{ id: "h0", read: true }]);
  assert.equal(requests[1]?.method, "PUT");
  assert.equal(requests[1]?.body, JSON.stringify([{ id: "h0", read: true }]));
});

test("SipgateBackend implements the delete_history_entries tool endpoint", async () => {
  const { backend, requests } = backendWithResponses([{ id: "h0" }, null]);
  const result = await backend.deleteHistoryEntries(["h0"]);
  assert.deepEqual(result.before, [{ id: "h0" }]);
  assert.equal(requests[1]?.method, "DELETE");
  assert.equal(new URL(requests[1]?.url ?? "").searchParams.toString(), "id=h0");
});

test("SipgateBackend implements the cancel_porting tool endpoint", async () => {
  const { backend, requests } = backendWithResponses([
    { id: "17", revocable: true },
    { items: [{ id: "17", status: 600 }] },
  ]);
  const result = await backend.cancelPorting(17, true);
  assert.deepEqual(result.before, { id: "17", revocable: true });
  assert.equal(requests[1]?.method, "DELETE");
  assert.equal(new URL(requests[1]?.url ?? "").pathname, "/v2/portings/17");
});

test("SipgateBackend implements the update_sipgateio_settings tool endpoint", async () => {
  const { backend, requests } = backendWithResponses([
    { incomingUrl: "https://old.example/in", outgoingUrl: "https://old.example/out" },
    null,
    { incomingUrl: "https://new.example/in", outgoingUrl: "https://new.example/out", log: true },
  ]);
  const result = await backend.updateSipgateIoSettings({
    incomingUrl: "https://new.example/in",
    outgoingUrl: "https://new.example/out",
    log: true,
    pushApiVersion: 1,
    whitelist: ["w0"],
  }, true);
  assert.deepEqual(result.before, {
    incomingUrl: "https://old.example/in",
    outgoingUrl: "https://old.example/out",
  });
  assert.equal(requests[1]?.method, "PUT");
  assert.equal(requests[1]?.body, JSON.stringify({
    incomingUrl: "https://new.example/in",
    outgoingUrl: "https://new.example/out",
    log: true,
    pushApiVersion: 1,
    whitelist: ["w0"],
  }));
});

test("SipgateBackend reports unavailable account-wide sipgate.io reads with status", async () => {
  const { backend: settingsBackend } = backendWithStatuses([{ status: 403 }]);
  const settings = await settingsBackend.getSipgateIoSettings() as Record<string, unknown>;
  assert.equal(settings.available, false);
  assert.equal(settings.httpStatus, 403);

  const { backend: logsBackend } = backendWithStatuses([{ status: 404 }]);
  const logs = await logsBackend.listWebhookLogs() as Record<string, unknown>;
  assert.deepEqual(logs.items, []);
  assert.equal(logs.httpStatus, 404);
});

test("SipgateBackend does not update unavailable sipgate.io settings", async () => {
  const { backend, requests } = backendWithStatuses([{ status: 403 }]);
  const result = await backend.updateSipgateIoSettings({
    incomingUrl: "https://example.com/in",
    outgoingUrl: "https://example.com/out",
  }, true);
  assert.equal(requests.length, 1);
  assert.equal((result.after as Record<string, unknown>).changed, false);
  assert.equal((result.after as Record<string, unknown>).httpStatus, 403);
});
