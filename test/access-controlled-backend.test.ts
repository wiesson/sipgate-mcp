import assert from "node:assert/strict";
import test from "node:test";
import {
  AccessPolicyError,
  createAccessControlledBackend,
} from "../src/backend/access-controlled-backend.js";
import type {
  AddressUpdateInput,
  AuthenticatedUserContext,
  BlockAnonymousInput,
  CallEmailNotificationInput,
  CallSmsNotificationInput,
  CallTransferInput,
  DeviceSettingsInput,
  DeviceType,
  FaxEmailNotificationInput,
  FaxReportNotificationInput,
  FaxSmsNotificationInput,
  ForwardingRule,
  GreetingUploadInput,
  HistoryQuery,
  JsonObject,
  JsonValue,
  LocalPrefixInput,
  MutationResult,
  PaginationInput,
  ParallelForwardingInput,
  QuickDialInput,
  ResendFaxInput,
  SendFaxInput,
  SmsEmailNotificationInput,
  TelephonyBackend,
  VoicemailEmailNotificationInput,
  VoicemailPlaybackInput,
  VoicemailRecordingInput,
  VoicemailSettingsInput,
  VoicemailSmsNotificationInput,
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
  public activeCalls: JsonValue = {
    data: [
      {
        callId: "c0",
        participants: [
          { participantId: "e0", phoneNumber: "+49211123456", owner: true },
          { participantId: "x0", phoneNumber: "+49301111111", owner: false },
        ],
      },
      {
        callId: "c9",
        participants: [
          { participantId: "e9", phoneNumber: "+49211999999", owner: true },
          { participantId: "x9", phoneNumber: "+49302222222", owner: false },
        ],
      },
    ],
  };
  public notifications: JsonValue = {
    call: [{ endpointId: "e0", emails: [{ id: "notice0", email: "me@example.com" }] }],
    fax: [],
    sms: [],
    voicemail: [],
  };
  public faxlines: JsonValue = { items: [{ id: "f0", canSend: true }] };
  public voicemails: JsonValue = { items: [{ id: "v0", active: true }] };
  public greetings: JsonValue = { items: [{ id: "g0", active: true }] };
  public parallelForwardings: JsonValue = { items: [{ id: "x0", active: true }] };

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
  getHistoryEntry(entryId: string): Promise<JsonValue> {
    return this.record("getHistoryEntry", [entryId], {
      id: entryId,
      connectionIds: entryId === "f0" ? ["e0"] : ["e9"],
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
  getPhoneline(userId: string, phonelineId: string): Promise<JsonValue> {
    return this.record("getPhoneline", [userId, phonelineId], { id: phonelineId });
  }
  getPhonelineBlockAnonymous(userId: string, phonelineId: string): Promise<JsonValue> {
    return this.record("getPhonelineBlockAnonymous", [userId, phonelineId], { enabled: false });
  }
  listPhonelineDevices(userId: string, phonelineId: string): Promise<JsonValue> {
    return this.record("listPhonelineDevices", [userId, phonelineId], this.devices);
  }
  listParallelForwardings(userId: string, phonelineId: string): Promise<JsonValue> {
    return this.record("listParallelForwardings", [userId, phonelineId], this.parallelForwardings);
  }
  listPhonelineVoicemails(userId: string, phonelineId: string): Promise<JsonValue> {
    return this.record("listPhonelineVoicemails", [userId, phonelineId], this.voicemails);
  }
  listVoicemailGreetings(userId: string, phonelineId: string, voicemailId: string): Promise<JsonValue> {
    return this.record("listVoicemailGreetings", [userId, phonelineId, voicemailId], this.greetings);
  }
  listVoicemails(): Promise<JsonValue> { return this.record("listVoicemails", [], this.voicemails); }
  getVoicemail(voicemailId: string): Promise<JsonValue> {
    return this.record("getVoicemail", [voicemailId], { id: voicemailId });
  }
  listAutorecordingGreetings(): Promise<JsonValue> {
    return this.record("listAutorecordingGreetings", [], { id: "ag0" });
  }
  getAutorecordingSettings(extension: string): Promise<JsonValue> {
    return this.record("getAutorecordingSettings", [extension], { active: false });
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
  listCalls(): Promise<JsonValue> { return this.record("listCalls", [], this.activeCalls); }
  listNotifications(userId: string): Promise<JsonValue> {
    return this.record("listNotifications", [userId], this.notifications);
  }
  listFaxlines(userId: string): Promise<JsonValue> {
    return this.record("listFaxlines", [userId], this.faxlines);
  }
  listFaxlineNumbers(userId: string, faxlineId: string): Promise<JsonValue> {
    return this.record("listFaxlineNumbers", [userId, faxlineId], {
      items: [{ id: "fn0", number: "+49211123456" }],
    });
  }
  getFaxlineCallerId(userId: string, faxlineId: string): Promise<JsonValue> {
    return this.record("getFaxlineCallerId", [userId, faxlineId], { value: "+49211123456" });
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
  createPhoneline(userId: string): Promise<MutationResult> {
    return this.mutation("createPhoneline", [userId]);
  }
  updatePhonelineAlias(userId: string, phonelineId: string, alias?: string): Promise<MutationResult> {
    return this.mutation("updatePhonelineAlias", [userId, phonelineId, alias]);
  }
  deletePhoneline(userId: string, phonelineId: string): Promise<MutationResult> {
    return this.mutation("deletePhoneline", [userId, phonelineId]);
  }
  setPhonelineBlockAnonymous(userId: string, phonelineId: string, input: BlockAnonymousInput): Promise<MutationResult> {
    return this.mutation("setPhonelineBlockAnonymous", [userId, phonelineId, input]);
  }
  attachDeviceToPhoneline(userId: string, phonelineId: string, deviceId: string): Promise<MutationResult> {
    return this.mutation("attachDeviceToPhoneline", [userId, phonelineId, deviceId]);
  }
  detachDeviceFromPhoneline(userId: string, phonelineId: string, deviceId: string): Promise<MutationResult> {
    return this.mutation("detachDeviceFromPhoneline", [userId, phonelineId, deviceId]);
  }
  createParallelForwarding(userId: string, phonelineId: string, input: ParallelForwardingInput): Promise<MutationResult> {
    return this.mutation("createParallelForwarding", [userId, phonelineId, input]);
  }
  updateParallelForwarding(
    userId: string,
    phonelineId: string,
    parallelForwardingId: string,
    input: ParallelForwardingInput,
  ): Promise<MutationResult> {
    return this.mutation("updateParallelForwarding", [userId, phonelineId, parallelForwardingId, input]);
  }
  deleteParallelForwarding(
    userId: string,
    phonelineId: string,
    parallelForwardingId: string,
  ): Promise<MutationResult> {
    return this.mutation("deleteParallelForwarding", [userId, phonelineId, parallelForwardingId]);
  }
  updateVoicemail(
    userId: string,
    phonelineId: string,
    voicemailId: string,
    input: VoicemailSettingsInput,
  ): Promise<MutationResult> {
    return this.mutation("updateVoicemail", [userId, phonelineId, voicemailId, input]);
  }
  createVoicemailGreeting(
    userId: string,
    phonelineId: string,
    voicemailId: string,
    input: GreetingUploadInput,
  ): Promise<MutationResult> {
    return this.mutation("createVoicemailGreeting", [userId, phonelineId, voicemailId, input]);
  }
  updateVoicemailGreeting(
    userId: string,
    phonelineId: string,
    voicemailId: string,
    greetingId: string,
    active?: boolean,
  ): Promise<MutationResult> {
    return this.mutation("updateVoicemailGreeting", [userId, phonelineId, voicemailId, greetingId, active]);
  }
  deleteVoicemailGreeting(
    userId: string,
    phonelineId: string,
    voicemailId: string,
    greetingId: string,
  ): Promise<MutationResult> {
    return this.mutation("deleteVoicemailGreeting", [userId, phonelineId, voicemailId, greetingId]);
  }
  setVoicemailTranscription(
    userId: string,
    phonelineId: string,
    voicemailId: string,
    active?: boolean,
  ): Promise<MutationResult> {
    return this.mutation("setVoicemailTranscription", [userId, phonelineId, voicemailId, active]);
  }
  playVoicemail(input: VoicemailPlaybackInput): Promise<MutationResult> {
    return this.mutation("playVoicemail", [input]);
  }
  recordVoicemailGreeting(input: VoicemailRecordingInput): Promise<MutationResult> {
    return this.mutation("recordVoicemailGreeting", [input]);
  }
  createAutorecordingGreeting(input: GreetingUploadInput): Promise<MutationResult> {
    return this.mutation("createAutorecordingGreeting", [input]);
  }
  deleteAutorecordingGreeting(greetingId: string): Promise<MutationResult> {
    return this.mutation("deleteAutorecordingGreeting", [greetingId]);
  }
  setAutorecordingSettings(extension: string, active?: boolean): Promise<MutationResult> {
    return this.mutation("setAutorecordingSettings", [extension, active]);
  }
  createFaxline(userId: string): Promise<MutationResult> {
    return this.mutation("createFaxline", [userId]);
  }
  updateFaxlineAlias(userId: string, faxlineId: string, alias?: string): Promise<MutationResult> {
    return this.mutation("updateFaxlineAlias", [userId, faxlineId, alias]);
  }
  deleteFaxline(userId: string, faxlineId: string): Promise<MutationResult> {
    return this.mutation("deleteFaxline", [userId, faxlineId]);
  }
  setFaxlineCallerId(userId: string, faxlineId: string, value?: string): Promise<MutationResult> {
    return this.mutation("setFaxlineCallerId", [userId, faxlineId, value]);
  }
  setFaxlineTagline(userId: string, faxlineId: string, value?: string): Promise<MutationResult> {
    return this.mutation("setFaxlineTagline", [userId, faxlineId, value]);
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
  createCallEmailNotification(input: CallEmailNotificationInput): Promise<MutationResult> {
    return this.mutation("createCallEmailNotification", [input]);
  }
  createCallSmsNotification(input: CallSmsNotificationInput): Promise<MutationResult> {
    return this.mutation("createCallSmsNotification", [input]);
  }
  createFaxEmailNotification(input: FaxEmailNotificationInput): Promise<MutationResult> {
    return this.mutation("createFaxEmailNotification", [input]);
  }
  createFaxSmsNotification(input: FaxSmsNotificationInput): Promise<MutationResult> {
    return this.mutation("createFaxSmsNotification", [input]);
  }
  createFaxReportNotification(input: FaxReportNotificationInput): Promise<MutationResult> {
    return this.mutation("createFaxReportNotification", [input]);
  }
  createSmsEmailNotification(input: SmsEmailNotificationInput): Promise<MutationResult> {
    return this.mutation("createSmsEmailNotification", [input]);
  }
  createVoicemailEmailNotification(
    input: VoicemailEmailNotificationInput,
  ): Promise<MutationResult> {
    return this.mutation("createVoicemailEmailNotification", [input]);
  }
  createVoicemailSmsNotification(input: VoicemailSmsNotificationInput): Promise<MutationResult> {
    return this.mutation("createVoicemailSmsNotification", [input]);
  }
  deleteNotification(userId: string, notificationId: string): Promise<MutationResult> {
    return this.mutation("deleteNotification", [userId, notificationId]);
  }
  hangupCall(callId: string): Promise<MutationResult> {
    return this.mutation("hangupCall", [callId]);
  }
  setCallHold(callId: string, value: boolean): Promise<MutationResult> {
    return this.mutation("setCallHold", [callId, value]);
  }
  setCallMuted(callId: string, value: boolean): Promise<MutationResult> {
    return this.mutation("setCallMuted", [callId, value]);
  }
  setCallRecording(
    callId: string,
    value: boolean,
    announcement?: boolean,
  ): Promise<MutationResult> {
    return this.mutation("setCallRecording", [callId, value, announcement]);
  }
  transferCall(callId: string, input: CallTransferInput): Promise<MutationResult> {
    return this.mutation("transferCall", [callId, input]);
  }
  sendCallDtmf(callId: string, sequence: string): Promise<MutationResult> {
    return this.mutation("sendCallDtmf", [callId, sequence]);
  }
  startCallAnnouncement(callId: string, url: string): Promise<MutationResult> {
    return this.mutation("startCallAnnouncement", [callId, url]);
  }
  sendFax(input: SendFaxInput): Promise<MutationResult> {
    return this.mutation("sendFax", [input]);
  }
  resendFax(input: ResendFaxInput): Promise<MutationResult> {
    return this.mutation("resendFax", [input]);
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
    () => backend.attachDeviceToPhoneline("w0", "p0", "e9"),
    () => backend.detachDeviceFromPhoneline("w0", "p0", "e9"),
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
    "attachDeviceToPhoneline",
    "detachDeviceFromPhoneline",
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

  const notificationDelegate = new FakeBackend();
  notificationDelegate.listNotifications = async () => {
    throw new Error("notification lookup unavailable");
  };
  const notificationBackend = await createAccessControlledBackend(notificationDelegate, "user");
  await assert.rejects(
    notificationBackend.deleteNotification("w0", "notice0"),
    AccessPolicyError,
  );

  const callDelegate = new FakeBackend();
  callDelegate.listCalls = async () => {
    throw new Error("call lookup unavailable");
  };
  const callBackend = await createAccessControlledBackend(callDelegate, "user");
  await assert.rejects(callBackend.hangupCall("c0"), AccessPolicyError);

  const faxDelegate = new FakeBackend();
  faxDelegate.listFaxlines = async () => {
    throw new Error("faxline lookup unavailable");
  };
  const faxBackend = await createAccessControlledBackend(faxDelegate, "user");
  await assert.rejects(faxBackend.sendFax({
    faxlineId: "f0",
    recipient: "+4921112345678",
    filename: "fax.pdf",
    base64Content: "cGRm",
  }), AccessPolicyError);
});

test("user scope hides foreign numbers attached to a shared address", async () => {
  const delegate = new FakeBackend();
  delegate.listAddressNumbers = async (addressId: number): Promise<JsonValue> => {
    delegate.calls.push({ method: "listAddressNumbers", args: [addressId] });
    return {
      items: [
        { id: "n0", number: "+49211123456" },
        { id: "n9", number: "+49211999999" },
      ],
    };
  };
  const backend = await createAccessControlledBackend(delegate, "user");

  const result = await backend.listAddressNumbers(123) as { items: JsonValue[] };

  assert.deepEqual(result.items, [{ id: "n0", number: "+49211123456" }]);
});

test("user scope refuses to edit an address shared with foreign numbers", async () => {
  const delegate = new FakeBackend();
  delegate.listAddressNumbers = async (addressId: number): Promise<JsonValue> => {
    delegate.calls.push({ method: "listAddressNumbers", args: [addressId] });
    return {
      items: [
        { id: "n0", number: "+49211123456" },
        { id: "n9", number: "+49211999999" },
      ],
    };
  };
  const backend = await createAccessControlledBackend(delegate, "user");

  await assert.rejects(
    backend.updateAddress(123, { city: "Kiel", countrycode: "DE", postcode: "24103" }),
    AccessPolicyError,
  );
  assert.equal(delegate.calls.some((call) => call.method === "updateAddress"), false);
});

test("user scope edits an address whose numbers are all owned", async () => {
  const delegate = new FakeBackend();
  const backend = await createAccessControlledBackend(delegate, "user");

  await backend.updateAddress(123, { city: "Kiel", countrycode: "DE", postcode: "24103" });

  assert.equal(delegate.calls.some((call) => call.method === "updateAddress"), true);
});

test("user scope owns quick dials that only the direct number endpoint lists", async () => {
  const delegate = new FakeBackend();
  delegate.getUserNumbers = async (userId: string): Promise<JsonValue> => {
    delegate.calls.push({ method: "getUserNumbers", args: [userId] });
    return { items: [{ id: "q0", number: "**11", type: ["QUICKDIAL"] }] };
  };
  const backend = await createAccessControlledBackend(delegate, "user");

  await backend.updateQuickDial("q0", { userId: "w0", quickDialNumber: "**12" });

  assert.equal(delegate.calls.some((call) => call.method === "updateQuickDial"), true);
});

test("user scope pages through every owned number before deciding ownership", async () => {
  const delegate = new FakeBackend();
  const firstPage = Array.from({ length: 1000 }, (_, index) => ({
    id: `n${index}`,
    number: `+4921100${index}`,
  }));
  delegate.listUserNumbers = async (
    userId: string,
    input: PaginationInput,
  ): Promise<JsonValue> => {
    delegate.calls.push({ method: "listUserNumbers", args: [userId, input] });
    return {
      items: input.offset === 0 ? firstPage : [{ id: "n1000", number: "+49211001000" }],
    };
  };
  const backend = await createAccessControlledBackend(delegate, "user");

  await backend.setNumberRouting("n1000", "e0");

  assert.equal(delegate.calls.some((call) => call.method === "setUserNumberRouting"), true);
});

test("user scope rejects a foreign notification ID", async () => {
  const delegate = new FakeBackend();
  const backend = await createAccessControlledBackend(delegate, "user");

  await assert.rejects(
    backend.deleteNotification("w0", "foreign-notice"),
    (error: unknown) => error instanceof AccessPolicyError && /notification/.test(error.message),
  );
  assert.equal(delegate.calls.some((call) => call.method === "deleteNotification"), false);
});

test("user scope filters active calls and rejects a foreign call ID", async () => {
  const delegate = new FakeBackend();
  const backend = await createAccessControlledBackend(delegate, "user");

  assert.deepEqual(await backend.listCalls(), {
    data: [{
      callId: "c0",
      participants: [
        { participantId: "e0", phoneNumber: "+49211123456", owner: true },
        { participantId: "x0", phoneNumber: "+49301111111", owner: false },
      ],
    }],
  });
  const mutations: Array<() => Promise<unknown>> = [
    () => backend.hangupCall("c9"),
    () => backend.setCallHold("c9", true),
    () => backend.setCallMuted("c9", true),
    () => backend.setCallRecording("c9", true, true),
    () => backend.transferCall("c9", { attended: false, phoneNumber: "+4915799912345" }),
    () => backend.sendCallDtmf("c9", "123"),
    () => backend.startCallAnnouncement("c9", "https://example.com/announcement.wav"),
  ];
  for (const mutation of mutations) {
    await assert.rejects(
      mutation(),
      (error: unknown) => error instanceof AccessPolicyError && /call/.test(error.message),
    );
  }
  assert.equal(delegate.calls.some((call) => [
    "hangupCall",
    "setCallHold",
    "setCallMuted",
    "setCallRecording",
    "transferCall",
    "sendCallDtmf",
    "startCallAnnouncement",
  ].includes(call.method)), false);
});

test("user scope rejects a foreign faxline", async () => {
  const delegate = new FakeBackend();
  const backend = await createAccessControlledBackend(delegate, "user");

  await assert.rejects(
    backend.listFaxlineNumbers("w0", "f9"),
    (error: unknown) => error instanceof AccessPolicyError && /faxline/.test(error.message),
  );
  await assert.rejects(
    backend.sendFax({
      faxlineId: "f9",
      recipient: "+4921112345678",
      filename: "fax.pdf",
      base64Content: "cGRm",
    }),
    AccessPolicyError,
  );
  assert.equal(delegate.calls.some((call) => ["listFaxlineNumbers", "sendFax"].includes(call.method)), false);
});

test("user scope rejects a foreign phoneline for every new phoneline operation", async () => {
  const delegate = new FakeBackend();
  const backend = await createAccessControlledBackend(delegate, "user");
  const operations: Array<() => Promise<unknown>> = [
    () => backend.getPhoneline("w0", "p9"),
    () => backend.getPhonelineBlockAnonymous("w0", "p9"),
    () => backend.listPhonelineDevices("w0", "p9"),
    () => backend.listParallelForwardings("w0", "p9"),
    () => backend.listPhonelineVoicemails("w0", "p9"),
    () => backend.updatePhonelineAlias("w0", "p9", "Foreign"),
    () => backend.deletePhoneline("w0", "p9"),
    () => backend.setPhonelineBlockAnonymous("w0", "p9", { enabled: true }),
    () => backend.createParallelForwarding("w0", "p9", { active: true }),
    () => backend.getAutorecordingSettings("p9"),
    () => backend.setAutorecordingSettings("p9", true),
  ];

  for (const operation of operations) await assert.rejects(operation(), AccessPolicyError);
  assert.equal(delegate.calls.some((call) => [
    "getPhoneline",
    "getPhonelineBlockAnonymous",
    "listPhonelineDevices",
    "listParallelForwardings",
    "listPhonelineVoicemails",
    "updatePhonelineAlias",
    "deletePhoneline",
    "setPhonelineBlockAnonymous",
    "createParallelForwarding",
    "getAutorecordingSettings",
    "setAutorecordingSettings",
  ].includes(call.method)), false);
});

test("user scope rejects a foreign voicemail", async () => {
  const delegate = new FakeBackend();
  const backend = await createAccessControlledBackend(delegate, "user");

  await assert.rejects(backend.getVoicemail("v9"), AccessPolicyError);
  await assert.rejects(
    backend.updateVoicemail("w0", "p0", "v9", { active: true, transcription: false }),
    AccessPolicyError,
  );
  await assert.rejects(
    backend.recordVoicemailGreeting({ deviceId: "e0", targetId: "v9", endpoint: "MAIN" }),
    AccessPolicyError,
  );
  assert.equal(delegate.calls.some((call) => [
    "getVoicemail",
    "updateVoicemail",
    "recordVoicemailGreeting",
  ].includes(call.method)), false);
});

test("user scope rejects a foreign voicemail greeting", async () => {
  const delegate = new FakeBackend();
  const backend = await createAccessControlledBackend(delegate, "user");

  await assert.rejects(
    backend.updateVoicemailGreeting("w0", "p0", "v0", "g9", true),
    AccessPolicyError,
  );
  await assert.rejects(
    backend.deleteVoicemailGreeting("w0", "p0", "v0", "g9"),
    AccessPolicyError,
  );
  assert.equal(delegate.calls.some((call) => [
    "updateVoicemailGreeting",
    "deleteVoicemailGreeting",
  ].includes(call.method)), false);
});

test("user scope rejects foreign nested recording and forwarding resources", async () => {
  const delegate = new FakeBackend();
  const backend = await createAccessControlledBackend(delegate, "user");

  await assert.rejects(
    backend.updateParallelForwarding("w0", "p0", "x9", { active: false }),
    AccessPolicyError,
  );
  await assert.rejects(
    backend.deleteParallelForwarding("w0", "p0", "x9"),
    AccessPolicyError,
  );
  await assert.rejects(backend.deleteAutorecordingGreeting("ag9"), AccessPolicyError);
  await assert.rejects(
    backend.playVoicemail({ deviceId: "e0", dataId: "foreign-history" }),
    AccessPolicyError,
  );
  await assert.rejects(
    backend.setFaxlineCallerId("w0", "f0", "+49211999999"),
    AccessPolicyError,
  );
  assert.equal(delegate.calls.some((call) => [
    "updateParallelForwarding",
    "deleteParallelForwarding",
    "deleteAutorecordingGreeting",
    "playVoicemail",
    "setFaxlineCallerId",
  ].includes(call.method)), false);
});

test("user scope rejects a foreign faxline for every new faxline configuration operation", async () => {
  const delegate = new FakeBackend();
  const backend = await createAccessControlledBackend(delegate, "user");
  const operations: Array<() => Promise<unknown>> = [
    () => backend.getFaxlineCallerId("w0", "f9"),
    () => backend.updateFaxlineAlias("w0", "f9", "Foreign"),
    () => backend.deleteFaxline("w0", "f9"),
    () => backend.setFaxlineCallerId("w0", "f9", "+49211123456"),
    () => backend.setFaxlineTagline("w0", "f9", "Foreign"),
    () => backend.getAutorecordingSettings("f9"),
  ];

  for (const operation of operations) await assert.rejects(operation(), AccessPolicyError);
  assert.equal(delegate.calls.some((call) => [
    "getFaxlineCallerId",
    "updateFaxlineAlias",
    "deleteFaxline",
    "setFaxlineCallerId",
    "setFaxlineTagline",
    "getAutorecordingSettings",
  ].includes(call.method)), false);
});

test("phoneline-less user scope returns unavailable instead of treating an absent feature as ownership", async () => {
  const delegate = new FakeBackend();
  delegate.listPhonelines = async (userId: string): Promise<JsonValue> => {
    delegate.calls.push({ method: "listPhonelines", args: [userId] });
    return { items: [], phonelinesAvailable: false };
  };
  const backend = await createAccessControlledBackend(delegate, "user");

  assert.deepEqual(await backend.getPhoneline("w0", "p0"), {
    phonelinesAvailable: false,
    note: "This sipgate account does not provide the phoneline feature.",
  });
  assert.deepEqual(await backend.updatePhonelineAlias("w0", "p0", "Office"), {
    before: null,
    after: {
      changed: false,
      phonelinesAvailable: false,
      note: "This sipgate account does not provide the phoneline feature; no change was attempted.",
    },
  });
  assert.equal(delegate.calls.some((call) => ["getPhoneline", "updatePhonelineAlias"].includes(call.method)), false);
});

test("user scope does not own a foreign call merely because its remote party is an owned number", async () => {
  const delegate = new FakeBackend();
  delegate.activeCalls = {
    data: [{
      callId: "c9",
      participants: [
        { participantId: "e9", phoneNumber: "+49211999999", owner: true },
        { participantId: "x9", phoneNumber: "+49211123456", owner: false },
      ],
    }],
  };
  const backend = await createAccessControlledBackend(delegate, "user");

  await assert.rejects(backend.hangupCall("c9"), AccessPolicyError);
  const listed = await backend.listCalls() as { data: JsonValue[] };
  assert.deepEqual(listed.data, []);
});

test("user scope denies a call whose owner participant is unmarked", async () => {
  const delegate = new FakeBackend();
  delegate.activeCalls = {
    data: [{
      callId: "c1",
      participants: [{ participantId: "e0", phoneNumber: "+49211123456" }],
    }],
  };
  const backend = await createAccessControlledBackend(delegate, "user");

  await assert.rejects(backend.hangupCall("c1"), AccessPolicyError);
});

test("user scope refuses to resend a fax belonging to another user", async () => {
  const delegate = new FakeBackend();
  const backend = await createAccessControlledBackend(delegate, "user");

  await assert.rejects(
    backend.resendFax({ faxId: "f9", faxlineId: "f0" }),
    AccessPolicyError,
  );
  assert.equal(delegate.calls.some((call) => call.method === "resendFax"), false);
});
