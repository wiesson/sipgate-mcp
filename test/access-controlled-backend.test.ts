import assert from "node:assert/strict";
import test from "node:test";
import {
  AccessPolicyError,
  createAccessControlledBackend,
} from "../src/backend/access-controlled-backend.js";
import type {
  AddressUpdateInput,
  AuthenticatedUserContext,
  DeviceSettingsInput,
  DeviceType,
  ForwardingRule,
  HistoryQuery,
  JsonObject,
  JsonValue,
  LocalPrefixInput,
  MutationResult,
  PaginationInput,
  QuickDialInput,
  TelephonyBackend,
} from "../src/backend/telephony-backend.js";

function itemsFrom(value: JsonValue): JsonObject[] {
  if (!value || Array.isArray(value) || typeof value !== "object") return [];
  const listed = value.items;
  return Array.isArray(listed)
    ? listed.filter((item): item is JsonObject => Boolean(item) && !Array.isArray(item) && typeof item === "object")
    : [];
}

class FakeBackend implements TelephonyBackend {
  public calls: Array<{ method: string; args: unknown[] }> = [];
  public admin = false;
  public routing: JsonValue = {
    numbers: [{ id: "n0", number: "+49211123456", endpointId: "p0" }],
    users: [{
      userId: "w0",
      phonelines: [{
        id: "p0",
        numbers: [{ id: "n0", number: "+49211123456", endpointId: "p0" }],
        forwardings: [],
      }],
    }],
  };
  public devices: JsonValue = { items: [{ id: "e0", userId: "w0" }] };
  public addresses: JsonValue = {
    items: [{ addressId: "123" }, { addressId: "999" }],
  };

  private record(method: string, args: unknown[], result: JsonValue): Promise<JsonValue> {
    this.calls.push({ method, args });
    return Promise.resolve(result);
  }

  private mutation(method: string, args: unknown[]): Promise<MutationResult> {
    this.calls.push({ method, args });
    return Promise.resolve({ before: null, after: null });
  }

  getAuthenticatedUser(): Promise<AuthenticatedUserContext> {
    this.calls.push({ method: "getAuthenticatedUser", args: [] });
    return Promise.resolve({ identity: { sub: "w0" }, userId: "w0" });
  }
  getUser(userId: string): Promise<JsonValue> {
    return this.record("getUser", [userId], { id: userId, admin: this.admin });
  }
  getAccountInfo(): Promise<JsonValue> {
    return this.record("getAccountInfo", [], { account: { company: "Example" } });
  }
  listUsers(): Promise<JsonValue> {
    return this.record("listUsers", [], { items: [{ id: "w0" }, { id: "w1" }] });
  }
  listNumbers(input: PaginationInput): Promise<JsonValue> {
    return this.record("listNumbers", [input], { items: [{ id: "n0" }, { id: "n1" }] });
  }
  listUserNumbers(userId: string, input: PaginationInput): Promise<JsonValue> {
    const object = this.routing as { numbers?: JsonValue };
    const numbers = Array.isArray(object.numbers) ? object.numbers : [];
    const page = numbers.slice(input.offset, input.offset + input.limit);
    return this.record("listUserNumbers", [userId, input], {
      items: page,
      pagination: {
        offset: input.offset,
        limit: input.limit,
        returned: page.length,
        totalCount: numbers.length,
      },
    });
  }
  getUserNumbers(userId: string): Promise<JsonValue> {
    return this.record("getUserNumbers", [userId], { items: [] });
  }
  listPhonelines(userId: string): Promise<JsonValue> {
    const object = this.routing as { users?: Array<{ phonelines?: JsonValue }> };
    return this.record("listPhonelines", [userId], {
      items: object.users?.[0]?.phonelines ?? [],
    });
  }
  listDevices(userId?: string, types?: DeviceType[]): Promise<JsonValue> {
    return this.record("listDevices", [userId, types], this.devices);
  }
  getDevice(deviceId: string): Promise<JsonValue> {
    const device = itemsFrom(this.devices).find((item) => item.id === deviceId) ?? { id: deviceId };
    return this.record("getDevice", [deviceId], device);
  }
  getDeviceCallerId(deviceId: string): Promise<JsonValue> {
    return this.record("getDeviceCallerId", [deviceId], { value: "+49211123456" });
  }
  getDeviceLocalPrefix(deviceId: string): Promise<JsonValue> {
    return this.record("getDeviceLocalPrefix", [deviceId], { active: true, value: "0211" });
  }
  getDeviceTariffAnnouncement(deviceId: string): Promise<JsonValue> {
    return this.record("getDeviceTariffAnnouncement", [deviceId], { enabled: false });
  }
  getDeviceSingleRowDisplay(deviceId: string): Promise<JsonValue> {
    return this.record("getDeviceSingleRowDisplay", [deviceId], { enabled: false });
  }
  getDeviceContingents(userId: string, deviceId: string): Promise<JsonValue> {
    return this.record("getDeviceContingents", [userId, deviceId], { contingents: [] });
  }
  listAddresses(): Promise<JsonValue> {
    return this.record("listAddresses", [], this.addresses);
  }
  getAddress(addressId: number): Promise<JsonValue> {
    return this.record("getAddress", [addressId], { addressId: String(addressId) });
  }
  listAddressNumbers(addressId: number): Promise<JsonValue> {
    return this.record("listAddressNumbers", [addressId], {
      items: addressId === 123 ? [{ id: "n0", number: "+49211123456" }] : [],
    });
  }
  validateQuickDialNumber(quickDialNumber: string): Promise<JsonValue> {
    return this.record("validateQuickDialNumber", [quickDialNumber], { valid: true });
  }
  getRouting(userId?: string): Promise<JsonValue> {
    return this.record("getRouting", [userId], this.routing);
  }
  getCallHistory(query: HistoryQuery): Promise<JsonValue> {
    return this.record("getCallHistory", [query], { items: [{ id: "h0" }] });
  }
  getSettings(userId?: string): Promise<JsonValue> {
    return this.record("getSettings", [userId], { users: [{ user: { id: userId ?? null } }] });
  }
  setNumberRouting(numberId: string, endpointId: string): Promise<MutationResult> {
    return this.mutation("setNumberRouting", [numberId, endpointId]);
  }
  setUserNumberRouting(userId: string, numberId: string, endpointId: string): Promise<MutationResult> {
    return this.mutation("setUserNumberRouting", [userId, numberId, endpointId]);
  }
  setForwarding(userId: string, phonelineId: string, forwardings: ForwardingRule[]): Promise<MutationResult> {
    return this.mutation("setForwarding", [userId, phonelineId, forwardings]);
  }
  setDnd(deviceId: string, enabled: boolean): Promise<MutationResult> {
    return this.mutation("setDnd", [deviceId, enabled]);
  }
  updateDevice(deviceId: string, settings: DeviceSettingsInput): Promise<MutationResult> {
    return this.mutation("updateDevice", [deviceId, settings]);
  }
  deleteDevice(deviceId: string): Promise<MutationResult> {
    return this.mutation("deleteDevice", [deviceId]);
  }
  setDeviceAlias(deviceId: string, value?: string): Promise<MutationResult> {
    return this.mutation("setDeviceAlias", [deviceId, value]);
  }
  setDeviceCallerId(deviceId: string, value?: string): Promise<MutationResult> {
    return this.mutation("setDeviceCallerId", [deviceId, value]);
  }
  setDeviceLocalPrefix(deviceId: string, input: LocalPrefixInput): Promise<MutationResult> {
    return this.mutation("setDeviceLocalPrefix", [deviceId, input]);
  }
  setDeviceTariffAnnouncement(deviceId: string, enabled?: boolean): Promise<MutationResult> {
    return this.mutation("setDeviceTariffAnnouncement", [deviceId, enabled]);
  }
  setDeviceSingleRowDisplay(deviceId: string, enabled?: boolean): Promise<MutationResult> {
    return this.mutation("setDeviceSingleRowDisplay", [deviceId, enabled]);
  }
  setExternalDeviceTargetNumber(deviceId: string, number?: string): Promise<MutationResult> {
    return this.mutation("setExternalDeviceTargetNumber", [deviceId, number]);
  }
  setExternalDeviceIncomingCallDisplay(
    deviceId: string,
    incomingCallDisplay: "CALLED_NUMBER" | "CALLER_NUMBER",
  ): Promise<MutationResult> {
    return this.mutation("setExternalDeviceIncomingCallDisplay", [deviceId, incomingCallDisplay]);
  }
  changeDevicePassword(deviceId: string): Promise<MutationResult> {
    return this.mutation("changeDevicePassword", [deviceId]);
  }
  createRegisterDevice(userId: string, alias?: string): Promise<MutationResult> {
    return this.mutation("createRegisterDevice", [userId, alias]);
  }
  createMobileDevice(userId: string, alias?: string): Promise<MutationResult> {
    return this.mutation("createMobileDevice", [userId, alias]);
  }
  createExternalDevice(userId: string, alias?: string, number?: string): Promise<MutationResult> {
    return this.mutation("createExternalDevice", [userId, alias, number]);
  }
  createQuickDial(input: QuickDialInput): Promise<MutationResult> {
    return this.mutation("createQuickDial", [input]);
  }
  updateQuickDial(quickDialId: string, input: QuickDialInput): Promise<MutationResult> {
    return this.mutation("updateQuickDial", [quickDialId, input]);
  }
  deleteQuickDial(numberId: string): Promise<MutationResult> {
    return this.mutation("deleteQuickDial", [numberId]);
  }
  updateAddress(addressId: number, input: AddressUpdateInput): Promise<MutationResult> {
    return this.mutation("updateAddress", [addressId, input]);
  }
  sendSms(input: {
    userId: string;
    smsId?: string;
    recipient: string;
    message: string;
    sendAt?: number;
  }): Promise<MutationResult> {
    return this.mutation("sendSms", [input]);
  }
  initiateCall(input: {
    caller: string;
    callee: string;
    callerId?: string;
    deviceId?: string;
  }): Promise<MutationResult> {
    return this.mutation("initiateCall", [input]);
  }
  initiateUserCall(input: {
    caller: string;
    callee: string;
    callerId?: string;
    deviceId?: string;
  }): Promise<MutationResult> {
    return this.mutation("initiateUserCall", [input]);
  }
}

test("user scope exposes only the authenticated user and never calls account-wide listUsers", async () => {
  const delegate = new FakeBackend();
  const backend = await createAccessControlledBackend(delegate, "user");

  const result = await backend.listUsers();

  assert.deepEqual(result, { items: [{ id: "w0", admin: false }] });
  assert.equal(delegate.calls.some((call) => call.method === "listUsers"), false);
});

test("user scope forces omitted user IDs and rejects another user", async () => {
  const delegate = new FakeBackend();
  const backend = await createAccessControlledBackend(delegate, "user");

  await backend.listDevices(undefined, ["register"]);
  assert.deepEqual(delegate.calls.at(-1), {
    method: "listDevices",
    args: ["w0", ["register"]],
  });
  await assert.rejects(
    async () => backend.getRouting("w1"),
    (error: unknown) => error instanceof AccessPolicyError && /w0/.test(error.message),
  );
});

test("user scope lists only numbers returned by the authenticated user's routing", async () => {
  const delegate = new FakeBackend();
  delegate.routing = {
    numbers: [
      { id: "n0", number: "+49211123456", endpointId: "p0" },
      { id: "n1", number: "+49211234567", endpointId: "p0" },
    ],
    users: [{ userId: "w0", phonelines: [{ id: "p0", numbers: [], forwardings: [] }] }],
  };
  const backend = await createAccessControlledBackend(delegate, "user");

  const result = await backend.listNumbers({ offset: 1, limit: 1 });

  assert.deepEqual(result, {
    items: [{ id: "n1", number: "+49211234567", endpointId: "p0" }],
    pagination: { offset: 1, limit: 1, returned: 1, totalCount: 2 },
  });
  assert.equal(delegate.calls.some((call) => call.method === "listNumbers"), false);
  assert.equal(delegate.calls.some((call) => call.method === "listUserNumbers"), true);
});

test("user scope constrains call history to owned connection IDs", async () => {
  const delegate = new FakeBackend();
  const backend = await createAccessControlledBackend(delegate, "user");

  await backend.getCallHistory({ offset: 0, limit: 25 });

  const historyCall = delegate.calls.find((call) => call.method === "getCallHistory");
  assert.ok(historyCall);
  const query = historyCall.args[0] as HistoryQuery;
  assert.deepEqual(new Set(query.connectionIds), new Set(["p0", "e0"]));

  await assert.rejects(
    backend.getCallHistory({ offset: 0, limit: 25, connectionIds: ["foreign"] }),
    (error: unknown) => error instanceof AccessPolicyError && /connection/.test(error.message),
  );
});

test("user scope permits owned write targets and rejects foreign resources", async () => {
  const delegate = new FakeBackend();
  const backend = await createAccessControlledBackend(delegate, "user");

  await backend.setNumberRouting("n0", "p0");
  await backend.setForwarding("w0", "p0", []);
  await backend.setDnd("e0", true);
  await backend.sendSms({ userId: "w0", recipient: "+4915799912345", message: "Hello" });

  assert.equal(delegate.calls.some((call) => call.method === "setUserNumberRouting"), true);
  assert.equal(delegate.calls.some((call) => call.method === "setNumberRouting"), false);
  assert.equal(delegate.calls.some((call) => call.method === "setForwarding"), true);
  assert.equal(delegate.calls.some((call) => call.method === "setDnd"), true);
  assert.equal(delegate.calls.some((call) => call.method === "sendSms"), true);

  await assert.rejects(backend.setNumberRouting("n1", "p0"), AccessPolicyError);
  await assert.rejects(backend.setForwarding("w1", "p0", []), AccessPolicyError);
  await assert.rejects(backend.setDnd("e1", true), AccessPolicyError);
  await assert.rejects(
    backend.sendSms({ userId: "w1", recipient: "+4915799912345", message: "Hello" }),
    AccessPolicyError,
  );
});

test("user scope only initiates calls from owned devices and numbers", async () => {
  const delegate = new FakeBackend();
  const backend = await createAccessControlledBackend(delegate, "user");

  await backend.initiateCall({
    caller: "e0",
    callee: "+4915799912345",
    callerId: "+49211123456",
  });
  assert.equal(delegate.calls.some((call) => call.method === "initiateUserCall"), true);
  assert.equal(delegate.calls.some((call) => call.method === "initiateCall"), false);
  await assert.rejects(
    backend.initiateCall({ caller: "e1", callee: "+4915799912345" }),
    AccessPolicyError,
  );
});

test("account scope requires an administrator and preserves account-wide operations", async () => {
  const regularUser = new FakeBackend();
  await assert.rejects(
    createAccessControlledBackend(regularUser, "account"),
    (error: unknown) => error instanceof AccessPolicyError && /administrator/.test(error.message),
  );

  const administrator = new FakeBackend();
  administrator.admin = true;
  const backend = await createAccessControlledBackend(administrator, "account");
  await backend.listDevices();
  await backend.getRouting("w1");

  assert.equal(administrator.calls.some((call) =>
    call.method === "getUser" && call.args[0] === "w0"), true);
  assert.equal(administrator.calls.some((call) =>
    call.method === "listDevices" && call.args[0] === undefined), true);
  assert.equal(administrator.calls.some((call) =>
    call.method === "getRouting" && call.args[0] === "w1"), true);
});

test("user scope scopes call history to devices when the account has no phonelines", async () => {
  const backend = new FakeBackend();
  backend.routing = { numbers: [], users: [{ userId: "w0", phonelines: [] }] };
  const scoped = await createAccessControlledBackend(backend, "user");

  await scoped.getCallHistory({ offset: 0, limit: 10 });

  const historyCall = backend.calls.find((call) => call.method === "getCallHistory");
  assert.ok(historyCall, "expected the history request to reach the delegate");
  const query = historyCall?.args[0] as HistoryQuery;
  assert.deepEqual(query.connectionIds, ["e0"]);
});

test("user scope accepts an owned device as routing destination without phonelines", async () => {
  const delegate = new FakeBackend();
  delegate.routing = {
    numbers: [{ id: "n0", number: "+49211123456", endpointId: "e0" }],
    users: [{ userId: "w0", phonelines: [] }],
  };
  const backend = await createAccessControlledBackend(delegate, "user");

  await backend.setNumberRouting("n0", "e0");

  assert.equal(delegate.calls.some((call) => call.method === "setUserNumberRouting"), true);
});

test("user scope still rejects a foreign routing destination", async () => {
  const delegate = new FakeBackend();
  delegate.routing = {
    numbers: [{ id: "n0", number: "+49211123456", endpointId: "e0" }],
    users: [{ userId: "w0", phonelines: [] }],
  };
  const backend = await createAccessControlledBackend(delegate, "user");

  await assert.rejects(backend.setNumberRouting("n0", "e9"), AccessPolicyError);
  assert.equal(delegate.calls.some((call) => call.method === "setUserNumberRouting"), false);
});

test("user scope rejects foreign device IDs for every new device-targeted operation", async () => {
  const delegate = new FakeBackend();
  const backend = await createAccessControlledBackend(delegate, "user");
  const operations: Array<() => Promise<unknown>> = [
    () => backend.updateDevice("e9", { dnd: true }),
    () => backend.deleteDevice("e9"),
    () => backend.setDeviceAlias("e9", "Foreign"),
    () => backend.setDeviceCallerId("e9", "+49211123456"),
    () => backend.setDeviceLocalPrefix("e9", { active: true, value: "0211" }),
    () => backend.setDeviceTariffAnnouncement("e9", true),
    () => backend.setDeviceSingleRowDisplay("e9", true),
    () => backend.setExternalDeviceTargetNumber("e9", "+49211234567"),
    () => backend.setExternalDeviceIncomingCallDisplay("e9", "CALLER_NUMBER"),
    () => backend.changeDevicePassword("e9"),
  ];

  for (const operation of operations) await assert.rejects(operation(), AccessPolicyError);
  assert.equal(delegate.calls.some((call) => [
    "updateDevice",
    "deleteDevice",
    "setDeviceAlias",
    "setDeviceCallerId",
    "setDeviceLocalPrefix",
    "setDeviceTariffAnnouncement",
    "setDeviceSingleRowDisplay",
    "setExternalDeviceTargetNumber",
    "setExternalDeviceIncomingCallDisplay",
    "changeDevicePassword",
  ].includes(call.method)), false);
});

test("user scope rejects foreign number IDs and caller-ID numbers", async () => {
  const delegate = new FakeBackend();
  const backend = await createAccessControlledBackend(delegate, "user");

  await assert.rejects(
    backend.updateQuickDial("n9", { userId: "w0", number: "43" }),
    AccessPolicyError,
  );
  await assert.rejects(backend.deleteQuickDial("n9"), AccessPolicyError);
  await assert.rejects(backend.setDeviceCallerId("e0", "+49211999999"), AccessPolicyError);
  assert.equal(delegate.calls.some((call) => [
    "updateQuickDial",
    "deleteQuickDial",
    "setDeviceCallerId",
  ].includes(call.method)), false);
});

test("user scope accepts owned addresses and rejects foreign address IDs", async () => {
  const delegate = new FakeBackend();
  const backend = await createAccessControlledBackend(delegate, "user");
  const address = {
    city: "Düsseldorf",
    countrycode: "DE",
    postcode: "40219",
  };

  await backend.updateAddress(123, address);
  await backend.updateDevice("e0", { emergencyAddressId: 123 });
  await assert.rejects(backend.updateAddress(999, address), AccessPolicyError);
  await assert.rejects(
    backend.updateDevice("e0", { emergencyAddressId: 999 }),
    AccessPolicyError,
  );

  const listed = await backend.listAddresses();
  assert.deepEqual(listed, { items: [{ addressId: "123" }] });
  assert.equal(delegate.calls.some((call) =>
    call.method === "updateAddress" && call.args[0] === 999), false);
});

test("user scope rejects device and quick-dial creation for a foreign user", async () => {
  const delegate = new FakeBackend();
  const backend = await createAccessControlledBackend(delegate, "user");

  await assert.rejects(
    async () => backend.createRegisterDevice("w1", "Register"),
    AccessPolicyError,
  );
  await assert.rejects(
    async () => backend.createMobileDevice("w1", "Mobile"),
    AccessPolicyError,
  );
  await assert.rejects(
    async () => backend.createExternalDevice("w1", "External", "+49211234567"),
    AccessPolicyError,
  );
  await assert.rejects(
    async () => backend.createQuickDial({ userId: "w1", number: "42" }),
    AccessPolicyError,
  );
});

test("user scope rejects foreign device and address IDs on read tools", async () => {
  const delegate = new FakeBackend();
  const backend = await createAccessControlledBackend(delegate, "user");

  await assert.rejects(backend.getDevice("e9"), AccessPolicyError);
  await assert.rejects(backend.getDeviceContingents("w0", "e9"), AccessPolicyError);
  await assert.rejects(backend.getAddress(999), AccessPolicyError);
  await assert.rejects(backend.listAddressNumbers(999), AccessPolicyError);
});

test("user-scoped mutations fail closed with AccessPolicyError when ownership cannot be read", async () => {
  const deviceDelegate = new FakeBackend();
  deviceDelegate.listDevices = async () => {
    throw new Error("device lookup unavailable");
  };
  const deviceBackend = await createAccessControlledBackend(deviceDelegate, "user");
  await assert.rejects(deviceBackend.deleteDevice("e0"), AccessPolicyError);

  const numberDelegate = new FakeBackend();
  numberDelegate.listUserNumbers = async () => {
    throw new Error("number lookup unavailable");
  };
  const numberBackend = await createAccessControlledBackend(numberDelegate, "user");
  await assert.rejects(numberBackend.deleteQuickDial("n0"), AccessPolicyError);

  const addressDelegate = new FakeBackend();
  addressDelegate.listAddressNumbers = async () => {
    throw new Error("address relationship lookup unavailable");
  };
  addressDelegate.routing = { numbers: [], users: [{ userId: "w0", phonelines: [] }] };
  const addressBackend = await createAccessControlledBackend(addressDelegate, "user");
  await assert.rejects(addressBackend.updateAddress(123, {
    city: "Düsseldorf",
    countrycode: "DE",
    postcode: "40219",
  }), AccessPolicyError);
});
