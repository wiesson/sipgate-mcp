import assert from "node:assert/strict";
import test from "node:test";
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
import { createToolDefinitions } from "../src/tools/definitions.js";

class FakeBackend implements TelephonyBackend {
  public calls: Array<{ method: string; args: unknown[] }> = [];

  private read(method: string, ...args: unknown[]): Promise<JsonValue> {
    this.calls.push({ method, args });
    return Promise.resolve({ method });
  }

  private write(method: string, ...args: unknown[]): Promise<MutationResult> {
    this.calls.push({ method, args });
    return Promise.resolve({ before: { value: "before" }, after: { value: "after" } });
  }

  getAuthenticatedUser(): Promise<AuthenticatedUserContext> {
    return Promise.resolve({ identity: { sub: "w0" }, userId: "w0" });
  }
  getUser(userId: string): Promise<JsonValue> { return this.read("getUser", userId); }
  getAccountInfo(): Promise<JsonValue> { return this.read("getAccountInfo"); }
  listUsers(): Promise<JsonValue> { return this.read("listUsers"); }
  listNumbers(input: PaginationInput): Promise<JsonValue> { return this.read("listNumbers", input); }
  listUserNumbers(userId: string, input: PaginationInput): Promise<JsonValue> {
    return this.read("listUserNumbers", userId, input);
  }
  listPhonelines(userId: string): Promise<JsonValue> { return this.read("listPhonelines", userId); }
  listDevices(userId?: string, types?: DeviceType[]): Promise<JsonValue> {
    return this.read("listDevices", userId, types);
  }
  getRouting(userId?: string): Promise<JsonValue> { return this.read("getRouting", userId); }
  getCallHistory(query: HistoryQuery): Promise<JsonValue> { return this.read("getCallHistory", query); }
  getSettings(userId?: string): Promise<JsonValue> { return this.read("getSettings", userId); }
  setNumberRouting(numberId: string, endpointId: string): Promise<MutationResult> {
    return this.write("setNumberRouting", numberId, endpointId);
  }
  setUserNumberRouting(userId: string, numberId: string, endpointId: string): Promise<MutationResult> {
    return this.write("setUserNumberRouting", userId, numberId, endpointId);
  }
  setForwarding(userId: string, phonelineId: string, forwardings: ForwardingRule[]): Promise<MutationResult> {
    return this.write("setForwarding", userId, phonelineId, forwardings);
  }
  setDnd(deviceId: string, enabled: boolean): Promise<MutationResult> {
    return this.write("setDnd", deviceId, enabled);
  }
  sendSms(input: {
    userId: string;
    smsId?: string;
    recipient: string;
    message: string;
    sendAt?: number;
  }): Promise<MutationResult> { return this.write("sendSms", input); }
  initiateCall(input: {
    caller: string;
    callee: string;
    callerId?: string;
    deviceId?: string;
  }): Promise<MutationResult> { return this.write("initiateCall", input); }
  initiateUserCall(input: {
    caller: string;
    callee: string;
    callerId?: string;
    deviceId?: string;
  }): Promise<MutationResult> { return this.write("initiateUserCall", input); }
}

async function invoke(backend: FakeBackend, name: string, input: unknown): Promise<JsonValue> {
  const definition = createToolDefinitions(backend).find((tool) => tool.name === name);
  assert.ok(definition, `missing tool ${name}`);
  return definition.execute(input);
}

test("account_info tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "account_info", {});
  assert.deepEqual(backend.calls, [{ method: "getAccountInfo", args: [] }]);
});

test("list_users tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "list_users", {});
  assert.deepEqual(backend.calls, [{ method: "listUsers", args: [] }]);
});

test("list_numbers tool applies pagination defaults", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "list_numbers", {});
  assert.deepEqual(backend.calls, [{ method: "listNumbers", args: [{ offset: 0, limit: 1000 }] }]);
});

test("list_devices tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "list_devices", { user_id: "w0", types: ["register"] });
  assert.deepEqual(backend.calls, [{ method: "listDevices", args: ["w0", ["register"]] }]);
});

test("get_routing tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "get_routing", { user_id: "w0" });
  assert.deepEqual(backend.calls, [{ method: "getRouting", args: ["w0"] }]);
});

test("call_history tool maps filters and pagination", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "call_history", {
    directions: ["MISSED_INCOMING"],
    phone_number: "+4915799912345",
    offset: 10,
    limit: 25,
  });
  assert.deepEqual(backend.calls, [{
    method: "getCallHistory",
    args: [{
      offset: 10,
      limit: 25,
      types: ["CALL"],
      directions: ["MISSED_INCOMING"],
      phoneNumber: "+4915799912345",
    }],
  }]);
});

test("get_settings tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "get_settings", { user_id: "w0" });
  assert.deepEqual(backend.calls, [{ method: "getSettings", args: ["w0"] }]);
});

test("set_number_routing tool", async () => {
  const backend = new FakeBackend();
  const result = await invoke(backend, "set_number_routing", { number_id: "n0", endpoint_id: "p0" });
  assert.deepEqual(backend.calls, [{ method: "setNumberRouting", args: ["n0", "p0"] }]);
  assert.deepEqual(result, { before: { value: "before" }, after: { value: "after" } });
});

test("set_forwarding tool accepts an empty list to clear routing", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "set_forwarding", { user_id: "w0", phoneline_id: "p0", forwardings: [] });
  assert.deepEqual(backend.calls, [{ method: "setForwarding", args: ["w0", "p0", []] }]);
});

test("set_dnd tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "set_dnd", { device_id: "e0", enabled: true });
  assert.deepEqual(backend.calls, [{ method: "setDnd", args: ["e0", true] }]);
});

test("send_sms tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "send_sms", {
    user_id: "w0",
    sms_id: "s0",
    recipient: "+4915799912345",
    message: "Hello",
    send_at: 1_800_000_000,
  });
  assert.deepEqual(backend.calls, [{ method: "sendSms", args: [{
    userId: "w0",
    smsId: "s0",
    recipient: "+4915799912345",
    message: "Hello",
    sendAt: 1_800_000_000,
  }] }]);
});

test("initiate_call tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "initiate_call", {
    caller: "e0",
    callee: "+4915799912345",
    caller_id: "+49211123456",
  });
  assert.deepEqual(backend.calls, [{ method: "initiateCall", args: [{
    caller: "e0",
    callee: "+4915799912345",
    callerId: "+49211123456",
  }] }]);
});

test("read-only mode does not register write tools", () => {
  const names = createToolDefinitions(new FakeBackend(), true).map((tool) => tool.name);
  assert.deepEqual(names, [
    "account_info",
    "list_users",
    "list_numbers",
    "list_devices",
    "get_routing",
    "call_history",
    "get_settings",
  ]);
});
