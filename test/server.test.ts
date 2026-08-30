import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { TelephonyBackend } from "../src/backend/telephony-backend.js";
import { createServer } from "../src/server.js";

function backend(): TelephonyBackend {
  const mutation = async () => ({ before: null, after: null });
  return {
    getAuthenticatedUser: async () => ({ identity: { sub: "w0" }, userId: "w0" }),
    getUser: async (userId) => ({ id: userId, admin: true }),
    getAccountInfo: async () => ({ account: { company: "Example" } }),
    listUsers: async () => ({ items: [] }),
    listNumbers: async () => ({ items: [] }),
    listUserNumbers: async () => ({ items: [] }),
    getUserNumbers: async () => ({ items: [] }),
    listPhonelines: async () => ({ items: [] }),
    getPhoneline: async () => ({}),
    getPhonelineBlockAnonymous: async () => ({}),
    listPhonelineDevices: async () => ({ items: [] }),
    listParallelForwardings: async () => ({ items: [] }),
    listPhonelineVoicemails: async () => ({ items: [] }),
    listVoicemailGreetings: async () => ({ items: [] }),
    listVoicemails: async () => ({ items: [] }),
    getVoicemail: async () => ({}),
    listAutorecordingGreetings: async () => ({}),
    getAutorecordingSettings: async () => ({}),
    listDevices: async () => ({ items: [] }),
    getDevice: async () => ({}),
    getDeviceCallerId: async () => ({}),
    getDeviceLocalPrefix: async () => ({}),
    getDeviceTariffAnnouncement: async () => ({}),
    getDeviceSingleRowDisplay: async () => ({}),
    getDeviceContingents: async () => ({ contingents: [] }),
    listAddresses: async () => ({ items: [] }),
    getAddress: async () => ({}),
    listAddressNumbers: async () => ({ items: [] }),
    validateQuickDialNumber: async () => ({}),
    listContacts: async () => ({ items: [] }),
    getContact: async () => ({}),
    listInternalContacts: async () => ({ items: [] }),
    exportContactsCsv: async () => ({ content: "" }),
    getContactsVcard: async () => ({ contacts: [] }),
    listIncomingBlacklist: async () => ({ items: [] }),
    getCallRestrictions: async () => ({}),
    getRestrictions: async () => ({ items: [] }),
    getRouting: async () => ({ numbers: [], users: [] }),
    getCallHistory: async () => ({ items: [] }),
    exportHistory: async () => ({ content: "" }),
    getHistoryEntry: async () => ({ items: [] }),
    listCalls: async () => ({ data: [] }),
    listNotifications: async () => ({ call: [], fax: [], sms: [], voicemail: [] }),
    listFaxlines: async () => ({ items: [] }),
    listFaxlineNumbers: async () => ({ items: [] }),
    getFaxlineCallerId: async () => ({}),
    getSettings: async () => ({ users: [] }),
    getBalance: async () => ({}),
    listPortings: async () => ({ items: [] }),
    getPorting: async () => ({}),
    getSipgateIoSettings: async () => ({}),
    listWebhookLogs: async () => ({ items: [] }),
    createContact: mutation,
    updateContact: mutation,
    deleteContact: mutation,
    deleteContacts: mutation,
    importContactsCsv: mutation,
    putContactsVcard: mutation,
    addIncomingBlacklist: mutation,
    removeIncomingBlacklist: mutation,
    setCallRestriction: mutation,
    setHistoryRead: mutation,
    setHistoryNote: mutation,
    setHistoryArchive: mutation,
    updateHistoryEntry: mutation,
    deleteHistoryEntry: mutation,
    updateHistoryEntries: mutation,
    deleteHistoryEntries: mutation,
    cancelPorting: mutation,
    updateSipgateIoSettings: mutation,
    setNumberRouting: mutation,
    setUserNumberRouting: mutation,
    setForwarding: mutation,
    createPhoneline: mutation,
    updatePhonelineAlias: mutation,
    deletePhoneline: mutation,
    setPhonelineBlockAnonymous: mutation,
    attachDeviceToPhoneline: mutation,
    detachDeviceFromPhoneline: mutation,
    createParallelForwarding: mutation,
    updateParallelForwarding: mutation,
    deleteParallelForwarding: mutation,
    updateVoicemail: mutation,
    createVoicemailGreeting: mutation,
    updateVoicemailGreeting: mutation,
    deleteVoicemailGreeting: mutation,
    setVoicemailTranscription: mutation,
    playVoicemail: mutation,
    recordVoicemailGreeting: mutation,
    createAutorecordingGreeting: mutation,
    deleteAutorecordingGreeting: mutation,
    setAutorecordingSettings: mutation,
    createFaxline: mutation,
    updateFaxlineAlias: mutation,
    deleteFaxline: mutation,
    setFaxlineCallerId: mutation,
    setFaxlineTagline: mutation,
    setDnd: mutation,
    updateDevice: mutation,
    deleteDevice: mutation,
    setDeviceAlias: mutation,
    setDeviceCallerId: mutation,
    setDeviceLocalPrefix: mutation,
    setDeviceTariffAnnouncement: mutation,
    setDeviceSingleRowDisplay: mutation,
    setExternalDeviceTargetNumber: mutation,
    setExternalDeviceIncomingCallDisplay: mutation,
    changeDevicePassword: mutation,
    createRegisterDevice: mutation,
    createMobileDevice: mutation,
    createExternalDevice: mutation,
    createQuickDial: mutation,
    updateQuickDial: mutation,
    deleteQuickDial: mutation,
    updateAddress: mutation,
    sendSms: mutation,
    initiateCall: mutation,
    initiateUserCall: mutation,
    createCallEmailNotification: mutation,
    createCallSmsNotification: mutation,
    createFaxEmailNotification: mutation,
    createFaxSmsNotification: mutation,
    createFaxReportNotification: mutation,
    createSmsEmailNotification: mutation,
    createVoicemailEmailNotification: mutation,
    createVoicemailSmsNotification: mutation,
    deleteNotification: mutation,
    hangupCall: mutation,
    setCallHold: mutation,
    setCallMuted: mutation,
    setCallRecording: mutation,
    transferCall: mutation,
    sendCallDtmf: mutation,
    startCallAnnouncement: mutation,
    sendFax: mutation,
    resendFax: mutation,
  };
}

test("MCP server lists JSON-schema tools and executes a tool over the SDK transport", async () => {
  const server = createServer(backend());
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 129);
    assert.equal(listed.tools.find((tool) => tool.name === "call_history")?.inputSchema.type, "object");
    assert.equal(client.getServerVersion()?.version, "0.5.0");
    assert.match(client.getInstructions() ?? "", /authenticated user's resources/);

    const result = await client.callTool({ name: "account_info", arguments: {} });
    assert.equal(result.isError, undefined);
    assert.match(JSON.stringify(result.content), /Example/);
  } finally {
    await client.close();
    await server.close();
  }
});

test("MCP server advertises administrator account scope and read-only mode", async () => {
  const server = createServer(backend(), true, "account");
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    assert.match(client.getInstructions() ?? "", /account scope/);
    assert.match(client.getInstructions() ?? "", /administrator/);
    assert.match(client.getInstructions() ?? "", /read-only/);
    assert.equal((await client.listTools()).tools.length, 47);
  } finally {
    await client.close();
    await server.close();
  }
});
