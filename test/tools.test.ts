import assert from "node:assert/strict";
import test from "node:test";
import type {
  AddressUpdateInput,
  AuthenticatedUserContext,
  CallEmailNotificationInput,
  CallSmsNotificationInput,
  CallTransferInput,
  DeviceSettingsInput,
  DeviceType,
  FaxEmailNotificationInput,
  FaxReportNotificationInput,
  FaxSmsNotificationInput,
  ForwardingRule,
  HistoryQuery,
  JsonValue,
  LocalPrefixInput,
  MutationResult,
  PaginationInput,
  QuickDialInput,
  ResendFaxInput,
  SendFaxInput,
  SmsEmailNotificationInput,
  TelephonyBackend,
  VoicemailEmailNotificationInput,
  VoicemailSmsNotificationInput,
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
  getUserNumbers(userId: string): Promise<JsonValue> { return this.read("getUserNumbers", userId); }
  listPhonelines(userId: string): Promise<JsonValue> { return this.read("listPhonelines", userId); }
  listDevices(userId?: string, types?: DeviceType[]): Promise<JsonValue> {
    return this.read("listDevices", userId, types);
  }
  getDevice(deviceId: string): Promise<JsonValue> { return this.read("getDevice", deviceId); }
  getDeviceCallerId(deviceId: string): Promise<JsonValue> { return this.read("getDeviceCallerId", deviceId); }
  getDeviceLocalPrefix(deviceId: string): Promise<JsonValue> { return this.read("getDeviceLocalPrefix", deviceId); }
  getDeviceTariffAnnouncement(deviceId: string): Promise<JsonValue> {
    return this.read("getDeviceTariffAnnouncement", deviceId);
  }
  getDeviceSingleRowDisplay(deviceId: string): Promise<JsonValue> {
    return this.read("getDeviceSingleRowDisplay", deviceId);
  }
  getDeviceContingents(userId: string, deviceId: string): Promise<JsonValue> {
    return this.read("getDeviceContingents", userId, deviceId);
  }
  listAddresses(): Promise<JsonValue> { return this.read("listAddresses"); }
  getAddress(addressId: number): Promise<JsonValue> { return this.read("getAddress", addressId); }
  listAddressNumbers(addressId: number): Promise<JsonValue> {
    return this.read("listAddressNumbers", addressId);
  }
  validateQuickDialNumber(quickDialNumber: string): Promise<JsonValue> {
    return this.read("validateQuickDialNumber", quickDialNumber);
  }
  getRouting(userId?: string): Promise<JsonValue> { return this.read("getRouting", userId); }
  getCallHistory(query: HistoryQuery): Promise<JsonValue> { return this.read("getCallHistory", query); }
  listCalls(): Promise<JsonValue> { return this.read("listCalls"); }
  listNotifications(userId: string): Promise<JsonValue> {
    return this.read("listNotifications", userId);
  }
  listFaxlines(userId: string): Promise<JsonValue> { return this.read("listFaxlines", userId); }
  listFaxlineNumbers(userId: string, faxlineId: string): Promise<JsonValue> {
    return this.read("listFaxlineNumbers", userId, faxlineId);
  }
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
  updateDevice(deviceId: string, settings: DeviceSettingsInput): Promise<MutationResult> {
    return this.write("updateDevice", deviceId, settings);
  }
  deleteDevice(deviceId: string): Promise<MutationResult> { return this.write("deleteDevice", deviceId); }
  setDeviceAlias(deviceId: string, value?: string): Promise<MutationResult> {
    return this.write("setDeviceAlias", deviceId, value);
  }
  setDeviceCallerId(deviceId: string, value?: string): Promise<MutationResult> {
    return this.write("setDeviceCallerId", deviceId, value);
  }
  setDeviceLocalPrefix(deviceId: string, input: LocalPrefixInput): Promise<MutationResult> {
    return this.write("setDeviceLocalPrefix", deviceId, input);
  }
  setDeviceTariffAnnouncement(deviceId: string, enabled?: boolean): Promise<MutationResult> {
    return this.write("setDeviceTariffAnnouncement", deviceId, enabled);
  }
  setDeviceSingleRowDisplay(deviceId: string, enabled?: boolean): Promise<MutationResult> {
    return this.write("setDeviceSingleRowDisplay", deviceId, enabled);
  }
  setExternalDeviceTargetNumber(deviceId: string, number?: string): Promise<MutationResult> {
    return this.write("setExternalDeviceTargetNumber", deviceId, number);
  }
  setExternalDeviceIncomingCallDisplay(
    deviceId: string,
    incomingCallDisplay: "CALLED_NUMBER" | "CALLER_NUMBER",
  ): Promise<MutationResult> {
    return this.write("setExternalDeviceIncomingCallDisplay", deviceId, incomingCallDisplay);
  }
  changeDevicePassword(deviceId: string): Promise<MutationResult> {
    return this.write("changeDevicePassword", deviceId);
  }
  createRegisterDevice(userId: string, alias?: string): Promise<MutationResult> {
    return this.write("createRegisterDevice", userId, alias);
  }
  createMobileDevice(userId: string, alias?: string): Promise<MutationResult> {
    return this.write("createMobileDevice", userId, alias);
  }
  createExternalDevice(userId: string, alias?: string, number?: string): Promise<MutationResult> {
    return this.write("createExternalDevice", userId, alias, number);
  }
  createQuickDial(input: QuickDialInput): Promise<MutationResult> {
    return this.write("createQuickDial", input);
  }
  updateQuickDial(quickDialId: string, input: QuickDialInput): Promise<MutationResult> {
    return this.write("updateQuickDial", quickDialId, input);
  }
  deleteQuickDial(numberId: string): Promise<MutationResult> {
    return this.write("deleteQuickDial", numberId);
  }
  updateAddress(addressId: number, input: AddressUpdateInput): Promise<MutationResult> {
    return this.write("updateAddress", addressId, input);
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
  createCallEmailNotification(input: CallEmailNotificationInput): Promise<MutationResult> {
    return this.write("createCallEmailNotification", input);
  }
  createCallSmsNotification(input: CallSmsNotificationInput): Promise<MutationResult> {
    return this.write("createCallSmsNotification", input);
  }
  createFaxEmailNotification(input: FaxEmailNotificationInput): Promise<MutationResult> {
    return this.write("createFaxEmailNotification", input);
  }
  createFaxSmsNotification(input: FaxSmsNotificationInput): Promise<MutationResult> {
    return this.write("createFaxSmsNotification", input);
  }
  createFaxReportNotification(input: FaxReportNotificationInput): Promise<MutationResult> {
    return this.write("createFaxReportNotification", input);
  }
  createSmsEmailNotification(input: SmsEmailNotificationInput): Promise<MutationResult> {
    return this.write("createSmsEmailNotification", input);
  }
  createVoicemailEmailNotification(
    input: VoicemailEmailNotificationInput,
  ): Promise<MutationResult> {
    return this.write("createVoicemailEmailNotification", input);
  }
  createVoicemailSmsNotification(input: VoicemailSmsNotificationInput): Promise<MutationResult> {
    return this.write("createVoicemailSmsNotification", input);
  }
  deleteNotification(userId: string, notificationId: string): Promise<MutationResult> {
    return this.write("deleteNotification", userId, notificationId);
  }
  hangupCall(callId: string): Promise<MutationResult> { return this.write("hangupCall", callId); }
  setCallHold(callId: string, value: boolean): Promise<MutationResult> {
    return this.write("setCallHold", callId, value);
  }
  setCallMuted(callId: string, value: boolean): Promise<MutationResult> {
    return this.write("setCallMuted", callId, value);
  }
  setCallRecording(
    callId: string,
    value: boolean,
    announcement?: boolean,
  ): Promise<MutationResult> {
    return this.write("setCallRecording", callId, value, announcement);
  }
  transferCall(callId: string, input: CallTransferInput): Promise<MutationResult> {
    return this.write("transferCall", callId, input);
  }
  sendCallDtmf(callId: string, sequence: string): Promise<MutationResult> {
    return this.write("sendCallDtmf", callId, sequence);
  }
  startCallAnnouncement(callId: string, url: string): Promise<MutationResult> {
    return this.write("startCallAnnouncement", callId, url);
  }
  sendFax(input: SendFaxInput): Promise<MutationResult> { return this.write("sendFax", input); }
  resendFax(input: ResendFaxInput): Promise<MutationResult> {
    return this.write("resendFax", input);
  }
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

test("get_device tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "get_device", { device_id: "e0" });
  assert.deepEqual(backend.calls, [{ method: "getDevice", args: ["e0"] }]);
});

test("get_device_caller_id tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "get_device_caller_id", { device_id: "e0" });
  assert.deepEqual(backend.calls, [{ method: "getDeviceCallerId", args: ["e0"] }]);
});

test("get_device_local_prefix tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "get_device_local_prefix", { device_id: "e0" });
  assert.deepEqual(backend.calls, [{ method: "getDeviceLocalPrefix", args: ["e0"] }]);
});

test("get_device_tariff_announcement tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "get_device_tariff_announcement", { device_id: "e0" });
  assert.deepEqual(backend.calls, [{ method: "getDeviceTariffAnnouncement", args: ["e0"] }]);
});

test("get_device_single_row_display tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "get_device_single_row_display", { device_id: "e0" });
  assert.deepEqual(backend.calls, [{ method: "getDeviceSingleRowDisplay", args: ["e0"] }]);
});

test("get_device_contingents tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "get_device_contingents", { user_id: "w0", device_id: "y0" });
  assert.deepEqual(backend.calls, [{ method: "getDeviceContingents", args: ["w0", "y0"] }]);
});

test("list_user_numbers tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "list_user_numbers", { user_id: "w0" });
  assert.deepEqual(backend.calls, [{ method: "getUserNumbers", args: ["w0"] }]);
});

test("validate_quick_dial tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "validate_quick_dial", { quick_dial_number: "42" });
  assert.deepEqual(backend.calls, [{ method: "validateQuickDialNumber", args: ["42"] }]);
});

test("list_addresses tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "list_addresses", {});
  assert.deepEqual(backend.calls, [{ method: "listAddresses", args: [] }]);
});

test("get_address tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "get_address", { address_id: 123 });
  assert.deepEqual(backend.calls, [{ method: "getAddress", args: [123] }]);
});

test("list_address_numbers tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "list_address_numbers", { address_id: 123 });
  assert.deepEqual(backend.calls, [{ method: "listAddressNumbers", args: [123] }]);
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

test("update_device tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "update_device", { device_id: "e0", dnd: true, emergency_address_id: 123 });
  assert.deepEqual(backend.calls, [{
    method: "updateDevice",
    args: ["e0", { dnd: true, emergencyAddressId: 123 }],
  }]);
});

test("delete_device tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "delete_device", { device_id: "e0" });
  assert.deepEqual(backend.calls, [{ method: "deleteDevice", args: ["e0"] }]);
});

test("set_device_alias tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "set_device_alias", { device_id: "e0", value: "Desk phone" });
  assert.deepEqual(backend.calls, [{ method: "setDeviceAlias", args: ["e0", "Desk phone"] }]);
});

test("set_device_caller_id tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "set_device_caller_id", { device_id: "e0", value: "+49211123456" });
  assert.deepEqual(backend.calls, [{ method: "setDeviceCallerId", args: ["e0", "+49211123456"] }]);
});

test("set_device_local_prefix tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "set_device_local_prefix", { device_id: "e0", active: true, value: "030" });
  assert.deepEqual(backend.calls, [{
    method: "setDeviceLocalPrefix",
    args: ["e0", { active: true, value: "030" }],
  }]);
});

test("set_device_tariff_announcement tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "set_device_tariff_announcement", { device_id: "e0", enabled: true });
  assert.deepEqual(backend.calls, [{ method: "setDeviceTariffAnnouncement", args: ["e0", true] }]);
});

test("set_device_single_row_display tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "set_device_single_row_display", { device_id: "e0", enabled: true });
  assert.deepEqual(backend.calls, [{ method: "setDeviceSingleRowDisplay", args: ["e0", true] }]);
});

test("set_external_device_target_number tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "set_external_device_target_number", { device_id: "x0", number: "+49211234567" });
  assert.deepEqual(backend.calls, [{ method: "setExternalDeviceTargetNumber", args: ["x0", "+49211234567"] }]);
});

test("set_external_device_incoming_call_display tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "set_external_device_incoming_call_display", {
    device_id: "x0",
    incoming_call_display: "CALLER_NUMBER",
  });
  assert.deepEqual(backend.calls, [{
    method: "setExternalDeviceIncomingCallDisplay",
    args: ["x0", "CALLER_NUMBER"],
  }]);
});

test("change_device_password tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "change_device_password", { device_id: "e0" });
  assert.deepEqual(backend.calls, [{ method: "changeDevicePassword", args: ["e0"] }]);
});

test("create_register_device tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "create_register_device", { user_id: "w0", alias: "Desk phone" });
  assert.deepEqual(backend.calls, [{ method: "createRegisterDevice", args: ["w0", "Desk phone"] }]);
});

test("create_mobile_device tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "create_mobile_device", { user_id: "w0", alias: "Mobile" });
  assert.deepEqual(backend.calls, [{ method: "createMobileDevice", args: ["w0", "Mobile"] }]);
});

test("create_external_device tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "create_external_device", {
    user_id: "w0",
    alias: "External",
    number: "+49211234567",
  });
  assert.deepEqual(backend.calls, [{
    method: "createExternalDevice",
    args: ["w0", "External", "+49211234567"],
  }]);
});

test("create_quick_dial tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "create_quick_dial", { user_id: "w0", number: "42" });
  assert.deepEqual(backend.calls, [{ method: "createQuickDial", args: [{ userId: "w0", number: "42" }] }]);
});

test("update_quick_dial tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "update_quick_dial", { quick_dial_id: "n0", user_id: "w0", number: "43" });
  assert.deepEqual(backend.calls, [{
    method: "updateQuickDial",
    args: ["n0", { userId: "w0", number: "43" }],
  }]);
});

test("delete_quick_dial tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "delete_quick_dial", { number_id: "n0" });
  assert.deepEqual(backend.calls, [{ method: "deleteQuickDial", args: ["n0"] }]);
});

test("update_address tool", async () => {
  const backend = new FakeBackend();
  await invoke(backend, "update_address", {
    address_id: 123,
    city: "Düsseldorf",
    countrycode: "DE",
    postcode: "40219",
    street: "Gladbacher Str.",
    number: "74",
  });
  assert.deepEqual(backend.calls, [{
    method: "updateAddress",
    args: [123, {
      city: "Düsseldorf",
      countrycode: "DE",
      postcode: "40219",
      number: "74",
      street: "Gladbacher Str.",
    }],
  }]);
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

const newToolCases: Array<{
  name: string;
  input: Record<string, unknown>;
  method: string;
  args: unknown[];
}> = [
  { name: "list_calls", input: {}, method: "listCalls", args: [] },
  {
    name: "list_notifications",
    input: { user_id: "w0" },
    method: "listNotifications",
    args: ["w0"],
  },
  {
    name: "list_faxlines",
    input: { user_id: "w0" },
    method: "listFaxlines",
    args: ["w0"],
  },
  {
    name: "list_faxline_numbers",
    input: { user_id: "w0", faxline_id: "f0" },
    method: "listFaxlineNumbers",
    args: ["w0", "f0"],
  },
  {
    name: "create_call_email_notification",
    input: {
      user_id: "w0",
      endpoint_id: "e0",
      cause: "MISSED",
      direction: "INCOMING",
      email: "me@example.com",
    },
    method: "createCallEmailNotification",
    args: [{
      userId: "w0",
      endpointId: "e0",
      cause: "MISSED",
      direction: "INCOMING",
      email: "me@example.com",
    }],
  },
  {
    name: "create_call_sms_notification",
    input: {
      user_id: "w0",
      endpoint_id: "e0",
      cause: "SUCCESSFUL",
      direction: "OUTGOING",
      number: "+4915799912345",
    },
    method: "createCallSmsNotification",
    args: [{
      userId: "w0",
      endpointId: "e0",
      cause: "SUCCESSFUL",
      direction: "OUTGOING",
      number: "+4915799912345",
    }],
  },
  {
    name: "create_fax_email_notification",
    input: {
      user_id: "w0",
      faxline_id: "f0",
      direction: "INCOMING",
      email: "me@example.com",
    },
    method: "createFaxEmailNotification",
    args: [{
      userId: "w0",
      faxlineId: "f0",
      direction: "INCOMING",
      email: "me@example.com",
    }],
  },
  {
    name: "create_fax_sms_notification",
    input: {
      user_id: "w0",
      faxline_id: "f0",
      direction: "OUTGOING",
      number: "+4915799912345",
    },
    method: "createFaxSmsNotification",
    args: [{
      userId: "w0",
      faxlineId: "f0",
      direction: "OUTGOING",
      number: "+4915799912345",
    }],
  },
  {
    name: "create_fax_report_notification",
    input: { user_id: "w0", faxline_id: "f0", email: "me@example.com" },
    method: "createFaxReportNotification",
    args: [{ userId: "w0", faxlineId: "f0", email: "me@example.com" }],
  },
  {
    name: "create_sms_email_notification",
    input: { user_id: "w0", endpoint_id: "y0", email: "me@example.com" },
    method: "createSmsEmailNotification",
    args: [{ userId: "w0", endpointId: "y0", email: "me@example.com" }],
  },
  {
    name: "create_voicemail_email_notification",
    input: { user_id: "w0", voicemail_id: "v0", email: "me@example.com" },
    method: "createVoicemailEmailNotification",
    args: [{ userId: "w0", voicemailId: "v0", email: "me@example.com" }],
  },
  {
    name: "create_voicemail_sms_notification",
    input: { user_id: "w0", voicemail_id: "v0", number: "+4915799912345" },
    method: "createVoicemailSmsNotification",
    args: [{ userId: "w0", voicemailId: "v0", number: "+4915799912345" }],
  },
  {
    name: "delete_notification",
    input: { user_id: "w0", notification_id: "notice0" },
    method: "deleteNotification",
    args: ["w0", "notice0"],
  },
  { name: "hangup_call", input: { call_id: "c0" }, method: "hangupCall", args: ["c0"] },
  {
    name: "set_call_hold",
    input: { call_id: "c0", value: true },
    method: "setCallHold",
    args: ["c0", true],
  },
  {
    name: "set_call_muted",
    input: { call_id: "c0", value: false },
    method: "setCallMuted",
    args: ["c0", false],
  },
  {
    name: "set_call_recording",
    input: { call_id: "c0", value: true, announcement: false },
    method: "setCallRecording",
    args: ["c0", true, false],
  },
  {
    name: "transfer_call",
    input: {
      call_id: "c0",
      attended: false,
      phone_number: "+4915799912345",
      caller_id: "+49211123456",
    },
    method: "transferCall",
    args: ["c0", {
      attended: false,
      phoneNumber: "+4915799912345",
      callerId: "+49211123456",
    }],
  },
  {
    name: "send_call_dtmf",
    input: { call_id: "c0", sequence: "123#" },
    method: "sendCallDtmf",
    args: ["c0", "123#"],
  },
  {
    name: "start_call_announcement",
    input: { call_id: "c0", url: "https://example.com/announcement.wav" },
    method: "startCallAnnouncement",
    args: ["c0", "https://example.com/announcement.wav"],
  },
  {
    name: "send_fax",
    input: {
      faxline_id: "f0",
      recipient: "+4921112345678",
      filename: "fax.pdf",
      base64_content: "cGRm",
    },
    method: "sendFax",
    args: [{
      faxlineId: "f0",
      recipient: "+4921112345678",
      filename: "fax.pdf",
      base64Content: "cGRm",
    }],
  },
  {
    name: "resend_fax",
    input: { fax_id: "100018428", faxline_id: "f0" },
    method: "resendFax",
    args: [{ faxId: "100018428", faxlineId: "f0" }],
  },
];

for (const tool of newToolCases) {
  test(`${tool.name} tool`, async () => {
    const backend = new FakeBackend();
    await invoke(backend, tool.name, tool.input);
    assert.deepEqual(backend.calls, [{ method: tool.method, args: tool.args }]);
  });
}

test("read-only mode does not register write tools", () => {
  const names = createToolDefinitions(new FakeBackend(), true).map((tool) => tool.name);
  assert.deepEqual(names, [
    "account_info",
    "list_users",
    "list_numbers",
    "list_devices",
    "get_device",
    "get_device_caller_id",
    "get_device_local_prefix",
    "get_device_tariff_announcement",
    "get_device_single_row_display",
    "get_device_contingents",
    "list_user_numbers",
    "validate_quick_dial",
    "list_addresses",
    "get_address",
    "list_address_numbers",
    "get_routing",
    "call_history",
    "list_calls",
    "list_notifications",
    "list_faxlines",
    "list_faxline_numbers",
    "get_settings",
  ]);
});

test("tool annotations and charge warnings distinguish every read and write tool", () => {
  const definitions = createToolDefinitions(new FakeBackend());
  for (const definition of definitions) {
    if (definition.annotations.readOnlyHint) continue;
    assert.match(
      definition.description,
      /CHANGES .*SIPGATE ACCOUNT AND MAY INCUR CHARGES/,
      `${definition.name} must warn about account changes and possible charges`,
    );
  }
  const recording = definitions.find((tool) => tool.name === "set_call_recording");
  assert.ok(recording);
  assert.match(recording.description, /Germany/);
  assert.match(recording.description, /responsible.*consent/i);
  for (const name of ["send_fax", "resend_fax"]) {
    const fax = definitions.find((tool) => tool.name === name);
    assert.ok(fax);
    assert.match(fax.description, /FAX INCURS CHARGES/);
  }
  assert.equal(definitions.filter((tool) => tool.annotations.readOnlyHint).length, 22);
  assert.equal(definitions.filter((tool) => !tool.annotations.readOnlyHint).length, 40);
});
