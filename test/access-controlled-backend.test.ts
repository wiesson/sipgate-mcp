import assert from "node:assert/strict";
import test from "node:test";
import {
  AccessPolicyError,
  createAccessControlledBackend,
} from "../src/backend/access-controlled-backend.js";
import type {
  AuthenticatedUserContext,
  DeviceType,
  ForwardingRule,
  HistoryQuery,
  JsonValue,
  MutationResult,
  PaginationInput,
  TelephonyBackend,
} from "../src/backend/telephony-backend.js";

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
  listPhonelines(userId: string): Promise<JsonValue> {
    const object = this.routing as { users?: Array<{ phonelines?: JsonValue }> };
    return this.record("listPhonelines", [userId], {
      items: object.users?.[0]?.phonelines ?? [],
    });
  }
  listDevices(userId?: string, types?: DeviceType[]): Promise<JsonValue> {
    return this.record("listDevices", [userId, types], this.devices);
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
