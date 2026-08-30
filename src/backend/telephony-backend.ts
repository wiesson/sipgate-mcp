export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type AccessScope = "user" | "account";

export interface AuthenticatedUserContext {
  identity: JsonObject;
  userId: string;
}

export type HistoryDirection =
  | "INCOMING"
  | "OUTGOING"
  | "MISSED_INCOMING"
  | "MISSED_OUTGOING";

export type HistoryType = "CALL" | "VOICEMAIL" | "SMS" | "FAX";
export type HistoryStarred = "STARRED" | "UNSTARRED";
export type DeviceType = "all" | "app" | "register" | "mobile" | "external";
export type ContactScope = "PRIVATE" | "SHARED" | "INTERNAL";
export type ContactWriteScope = ContactScope | "PRIVATE,SHARED";

export interface PaginationInput {
  offset: number;
  limit: number;
}

export interface HistoryQuery extends PaginationInput {
  archived?: boolean;
  directions?: HistoryDirection[];
  from?: string;
  to?: string;
  phoneNumber?: string;
  starred?: HistoryStarred[];
  types?: HistoryType[];
  connectionIds?: string[];
}

export type HistoryExportQuery = Omit<HistoryQuery, "phoneNumber">;

export interface ContactQuery {
  phoneNumbers?: string[];
  limit?: number;
  offset?: number;
  lastId?: string;
  scopes?: ContactScope[];
}

export interface ContactInput {
  addresses?: Record<string, unknown>[] | undefined;
  emails?: Record<string, unknown>[] | undefined;
  family?: string | undefined;
  given?: string | undefined;
  name?: string | undefined;
  note?: string | undefined;
  numbers?: Record<string, unknown>[] | undefined;
  organization?: string[][] | undefined;
  picture?: string | undefined;
  scope?: ContactWriteScope | undefined;
  websites?: Record<string, unknown>[] | undefined;
}

export interface ContactUpdateInput extends ContactInput {
  id?: string | undefined;
}

export interface DeleteContactsInput {
  contactIds?: string[] | undefined;
  scope?: ContactWriteScope[] | undefined;
  source?: string | undefined;
}

export interface ContactsVcardQuery {
  scopes: ContactScope[];
  labels?: string[];
  contactIds?: string[];
  wantedFields?: string[];
  filter?: string;
  limit?: number;
  offset?: number;
  lastId?: string;
}

export interface HistoryEntryUpdateInput {
  archived?: boolean | undefined;
  note?: string | undefined;
  read?: boolean | undefined;
  starred?: boolean | undefined;
}

export interface BulkHistoryEntryUpdateInput {
  id: string;
  archived?: boolean | undefined;
  read?: boolean | undefined;
  starred?: boolean | undefined;
}

export interface StructuredVCardUpsertInput {
  contactId?: string | undefined;
  item?: Record<string, Record<string, unknown>[]> | undefined;
}

export interface SipgateIoSettingsInput {
  incomingUrl: string;
  outgoingUrl: string;
  log?: boolean | undefined;
  pushApiVersion?: number | undefined;
  whitelist?: string[] | undefined;
}

export interface ForwardingRule {
  [key: string]: JsonValue;
  active: boolean;
  destination: string;
  timeout: number;
}

export interface MutationResult {
  [key: string]: JsonValue;
  before: JsonValue;
  after: JsonValue;
}

export interface DeviceSettingsInput {
  [key: string]: JsonValue | undefined;
  dnd?: boolean;
  emergencyAddressId?: number;
}

export interface LocalPrefixInput {
  [key: string]: JsonValue | undefined;
  active?: boolean;
  value?: string;
}

export interface QuickDialInput {
  [key: string]: JsonValue | undefined;
  userId: string;
  number?: string;
}

export interface AddressUpdateInput {
  [key: string]: JsonValue | undefined;
  city: string;
  countrycode: string;
  postcode: string;
  address1?: string;
  address2?: string;
  number?: string;
  state?: string;
  street?: string;
}

export type NotificationDirection = "INCOMING" | "OUTGOING";
export type CallNotificationCause = "MISSED" | "SUCCESSFUL";

export interface CallEmailNotificationInput {
  userId: string;
  endpointId: string;
  direction: NotificationDirection;
  cause: CallNotificationCause;
  email: string;
}

export interface CallSmsNotificationInput {
  userId: string;
  endpointId: string;
  direction: NotificationDirection;
  cause: CallNotificationCause;
  number: string;
}

export interface FaxEmailNotificationInput {
  userId: string;
  faxlineId: string;
  direction: NotificationDirection;
  email: string;
}

export interface FaxSmsNotificationInput {
  userId: string;
  faxlineId: string;
  direction: NotificationDirection;
  number: string;
}

export interface FaxReportNotificationInput {
  userId: string;
  faxlineId: string;
  email: string;
}

export interface SmsEmailNotificationInput {
  userId: string;
  endpointId: string;
  email: string;
}

export interface VoicemailEmailNotificationInput {
  userId: string;
  voicemailId: string;
  email: string;
}

export interface VoicemailSmsNotificationInput {
  userId: string;
  voicemailId: string;
  number: string;
}

export interface CallTransferInput {
  attended: boolean;
  phoneNumber: string;
  callerId?: string;
}

export interface SendFaxInput {
  faxlineId: string;
  recipient: string;
  filename: string;
  base64Content: string;
}

export interface ResendFaxInput {
  faxId: string;
  faxlineId?: string;
}

export interface BlockAnonymousInput {
  enabled?: boolean;
  target?: "REJECT" | "VOICEMAIL";
}

export interface ParallelForwardingInput {
  active?: boolean;
  alias?: string;
  destination?: string;
}

export interface VoicemailSettingsInput {
  active: boolean;
  transcription: boolean;
  timeout?: number;
}

export interface GreetingUploadInput {
  base64Content?: string;
  filename?: string;
}

export interface VoicemailPlaybackInput {
  dataId?: string;
  deviceId?: string;
}

export interface VoicemailRecordingInput {
  deviceId?: string;
  endpoint?: string;
  targetId?: string;
}

export interface TelephonyBackend {
  getAuthenticatedUser(): Promise<AuthenticatedUserContext>;
  getUser(userId: string): Promise<JsonValue>;
  getAccountInfo(): Promise<JsonValue>;
  listUsers(): Promise<JsonValue>;
  listNumbers(pagination: PaginationInput): Promise<JsonValue>;
  listUserNumbers(userId: string, pagination: PaginationInput): Promise<JsonValue>;
  getUserNumbers(userId: string): Promise<JsonValue>;
  listPhonelines(userId: string): Promise<JsonValue>;
  getPhoneline(userId: string, phonelineId: string): Promise<JsonValue>;
  getPhonelineBlockAnonymous(userId: string, phonelineId: string): Promise<JsonValue>;
  listPhonelineDevices(userId: string, phonelineId: string): Promise<JsonValue>;
  listParallelForwardings(userId: string, phonelineId: string): Promise<JsonValue>;
  listPhonelineVoicemails(userId: string, phonelineId: string): Promise<JsonValue>;
  listVoicemailGreetings(
    userId: string,
    phonelineId: string,
    voicemailId: string,
  ): Promise<JsonValue>;
  listVoicemails(): Promise<JsonValue>;
  getVoicemail(voicemailId: string): Promise<JsonValue>;
  listAutorecordingGreetings(): Promise<JsonValue>;
  getAutorecordingSettings(extension: string): Promise<JsonValue>;
  listDevices(userId?: string, types?: DeviceType[]): Promise<JsonValue>;
  getDevice(deviceId: string): Promise<JsonValue>;
  getDeviceCallerId(deviceId: string): Promise<JsonValue>;
  getDeviceLocalPrefix(deviceId: string): Promise<JsonValue>;
  getDeviceTariffAnnouncement(deviceId: string): Promise<JsonValue>;
  getDeviceSingleRowDisplay(deviceId: string): Promise<JsonValue>;
  getDeviceContingents(userId: string, deviceId: string): Promise<JsonValue>;
  listAddresses(): Promise<JsonValue>;
  getAddress(addressId: number): Promise<JsonValue>;
  listAddressNumbers(addressId: number): Promise<JsonValue>;
  validateQuickDialNumber(quickDialNumber: string): Promise<JsonValue>;
  listContacts(query: ContactQuery): Promise<JsonValue>;
  getContact(contactId: string): Promise<JsonValue>;
  listInternalContacts(): Promise<JsonValue>;
  exportContactsCsv(scopes: ContactScope[]): Promise<JsonValue>;
  getContactsVcard(query: ContactsVcardQuery): Promise<JsonValue>;
  listIncomingBlacklist(): Promise<JsonValue>;
  getCallRestrictions(userIds?: string[]): Promise<JsonValue>;
  getRestrictions(userId: string, restrictions?: string[]): Promise<JsonValue>;
  getRouting(userId?: string): Promise<JsonValue>;
  getCallHistory(query: HistoryQuery): Promise<JsonValue>;
  exportHistory(query: HistoryExportQuery): Promise<JsonValue>;
  getHistoryEntry(entryId: string): Promise<JsonValue>;
  listSmsExtensions(userId: string): Promise<JsonValue>;
  listCalls(): Promise<JsonValue>;
  listNotifications(userId: string): Promise<JsonValue>;
  listFaxlines(userId: string): Promise<JsonValue>;
  listFaxlineNumbers(userId: string, faxlineId: string): Promise<JsonValue>;
  getFaxlineCallerId(userId: string, faxlineId: string): Promise<JsonValue>;
  getSettings(userId?: string): Promise<JsonValue>;
  getBalance(): Promise<JsonValue>;
  listPortings(): Promise<JsonValue>;
  getPorting(portingId: number): Promise<JsonValue>;
  getSipgateIoSettings(): Promise<JsonValue>;
  listWebhookLogs(): Promise<JsonValue>;
  createContact(input: ContactInput, confirmAccountWide?: boolean): Promise<MutationResult>;
  updateContact(
    contactId: string,
    input: ContactUpdateInput,
    confirmAccountWide?: boolean,
  ): Promise<MutationResult>;
  deleteContact(
    contactId: string,
    scopes?: ContactScope[],
    confirmAccountWide?: boolean,
  ): Promise<MutationResult>;
  deleteContacts(
    input: DeleteContactsInput,
    confirmAccountWide?: boolean,
  ): Promise<MutationResult>;
  importContactsCsv(base64Content: string, confirmAccountWide?: boolean): Promise<MutationResult>;
  putContactsVcard(
    scope: ContactScope,
    data: StructuredVCardUpsertInput[],
    confirmAccountWide?: boolean,
  ): Promise<MutationResult>;
  addIncomingBlacklist(
    phoneNumber: string,
    isBlock?: boolean,
    confirmAccountWide?: boolean,
  ): Promise<MutationResult>;
  removeIncomingBlacklist(
    phoneNumber: string,
    confirmAccountWide?: boolean,
  ): Promise<MutationResult>;
  setCallRestriction(restriction: string, enabled?: boolean): Promise<MutationResult>;
  setHistoryRead(entryId: string, value?: boolean): Promise<MutationResult>;
  setHistoryNote(entryId: string, note: string): Promise<MutationResult>;
  setHistoryArchive(entryId: string, value?: boolean): Promise<MutationResult>;
  updateHistoryEntry(
    entryId: string,
    input: HistoryEntryUpdateInput,
  ): Promise<MutationResult>;
  deleteHistoryEntry(entryId: string): Promise<MutationResult>;
  updateHistoryEntries(inputs: BulkHistoryEntryUpdateInput[]): Promise<MutationResult>;
  deleteHistoryEntries(entryIds?: string[]): Promise<MutationResult>;
  cancelPorting(portingId: number, confirmAccountWide?: boolean): Promise<MutationResult>;
  updateSipgateIoSettings(
    input: SipgateIoSettingsInput,
    confirmAccountWide?: boolean,
  ): Promise<MutationResult>;
  setNumberRouting(numberId: string, endpointId: string): Promise<MutationResult>;
  setUserNumberRouting(
    userId: string,
    numberId: string,
    endpointId: string,
  ): Promise<MutationResult>;
  setForwarding(
    userId: string,
    phonelineId: string,
    forwardings: ForwardingRule[],
  ): Promise<MutationResult>;
  createPhoneline(userId: string): Promise<MutationResult>;
  updatePhonelineAlias(
    userId: string,
    phonelineId: string,
    alias?: string,
  ): Promise<MutationResult>;
  deletePhoneline(userId: string, phonelineId: string): Promise<MutationResult>;
  setPhonelineBlockAnonymous(
    userId: string,
    phonelineId: string,
    input: BlockAnonymousInput,
  ): Promise<MutationResult>;
  attachDeviceToPhoneline(
    userId: string,
    phonelineId: string,
    deviceId: string,
  ): Promise<MutationResult>;
  detachDeviceFromPhoneline(
    userId: string,
    phonelineId: string,
    deviceId: string,
  ): Promise<MutationResult>;
  createParallelForwarding(
    userId: string,
    phonelineId: string,
    input: ParallelForwardingInput,
  ): Promise<MutationResult>;
  updateParallelForwarding(
    userId: string,
    phonelineId: string,
    parallelForwardingId: string,
    input: ParallelForwardingInput,
  ): Promise<MutationResult>;
  deleteParallelForwarding(
    userId: string,
    phonelineId: string,
    parallelForwardingId: string,
  ): Promise<MutationResult>;
  updateVoicemail(
    userId: string,
    phonelineId: string,
    voicemailId: string,
    input: VoicemailSettingsInput,
  ): Promise<MutationResult>;
  createVoicemailGreeting(
    userId: string,
    phonelineId: string,
    voicemailId: string,
    input: GreetingUploadInput,
  ): Promise<MutationResult>;
  updateVoicemailGreeting(
    userId: string,
    phonelineId: string,
    voicemailId: string,
    greetingId: string,
    active?: boolean,
  ): Promise<MutationResult>;
  deleteVoicemailGreeting(
    userId: string,
    phonelineId: string,
    voicemailId: string,
    greetingId: string,
  ): Promise<MutationResult>;
  setVoicemailTranscription(
    userId: string,
    phonelineId: string,
    voicemailId: string,
    active?: boolean,
  ): Promise<MutationResult>;
  playVoicemail(input: VoicemailPlaybackInput): Promise<MutationResult>;
  recordVoicemailGreeting(input: VoicemailRecordingInput): Promise<MutationResult>;
  createAutorecordingGreeting(input: GreetingUploadInput): Promise<MutationResult>;
  deleteAutorecordingGreeting(greetingId: string): Promise<MutationResult>;
  setAutorecordingSettings(extension: string, active?: boolean): Promise<MutationResult>;
  createFaxline(userId: string): Promise<MutationResult>;
  updateFaxlineAlias(userId: string, faxlineId: string, alias?: string): Promise<MutationResult>;
  deleteFaxline(userId: string, faxlineId: string): Promise<MutationResult>;
  setFaxlineCallerId(userId: string, faxlineId: string, value?: string): Promise<MutationResult>;
  setFaxlineTagline(userId: string, faxlineId: string, value?: string): Promise<MutationResult>;
  setDnd(deviceId: string, enabled: boolean): Promise<MutationResult>;
  updateDevice(deviceId: string, settings: DeviceSettingsInput): Promise<MutationResult>;
  deleteDevice(deviceId: string): Promise<MutationResult>;
  setDeviceAlias(deviceId: string, value?: string): Promise<MutationResult>;
  setDeviceCallerId(deviceId: string, value?: string): Promise<MutationResult>;
  setDeviceLocalPrefix(deviceId: string, input: LocalPrefixInput): Promise<MutationResult>;
  setDeviceTariffAnnouncement(deviceId: string, enabled?: boolean): Promise<MutationResult>;
  setDeviceSingleRowDisplay(deviceId: string, enabled?: boolean): Promise<MutationResult>;
  setExternalDeviceTargetNumber(deviceId: string, number?: string): Promise<MutationResult>;
  setExternalDeviceIncomingCallDisplay(
    deviceId: string,
    incomingCallDisplay: "CALLED_NUMBER" | "CALLER_NUMBER",
  ): Promise<MutationResult>;
  changeDevicePassword(deviceId: string): Promise<MutationResult>;
  createRegisterDevice(userId: string, alias?: string): Promise<MutationResult>;
  createMobileDevice(userId: string, alias?: string): Promise<MutationResult>;
  createExternalDevice(userId: string, alias?: string, number?: string): Promise<MutationResult>;
  createQuickDial(input: QuickDialInput): Promise<MutationResult>;
  updateQuickDial(quickDialId: string, input: QuickDialInput): Promise<MutationResult>;
  deleteQuickDial(numberId: string): Promise<MutationResult>;
  updateAddress(addressId: number, input: AddressUpdateInput): Promise<MutationResult>;
  sendSms(input: {
    userId: string;
    smsId?: string;
    recipient: string;
    message: string;
    sendAt?: number;
  }): Promise<MutationResult>;
  initiateCall(input: {
    caller: string;
    callee: string;
    callerId?: string;
    deviceId?: string;
  }): Promise<MutationResult>;
  initiateUserCall(input: {
    caller: string;
    callee: string;
    callerId?: string;
    deviceId?: string;
  }): Promise<MutationResult>;
  createCallEmailNotification(input: CallEmailNotificationInput): Promise<MutationResult>;
  createCallSmsNotification(input: CallSmsNotificationInput): Promise<MutationResult>;
  createFaxEmailNotification(input: FaxEmailNotificationInput): Promise<MutationResult>;
  createFaxSmsNotification(input: FaxSmsNotificationInput): Promise<MutationResult>;
  createFaxReportNotification(input: FaxReportNotificationInput): Promise<MutationResult>;
  createSmsEmailNotification(input: SmsEmailNotificationInput): Promise<MutationResult>;
  createVoicemailEmailNotification(
    input: VoicemailEmailNotificationInput,
  ): Promise<MutationResult>;
  createVoicemailSmsNotification(input: VoicemailSmsNotificationInput): Promise<MutationResult>;
  deleteNotification(userId: string, notificationId: string): Promise<MutationResult>;
  hangupCall(callId: string): Promise<MutationResult>;
  setCallHold(callId: string, value: boolean): Promise<MutationResult>;
  setCallMuted(callId: string, value: boolean): Promise<MutationResult>;
  setCallRecording(
    callId: string,
    value: boolean,
    announcement?: boolean,
  ): Promise<MutationResult>;
  transferCall(callId: string, input: CallTransferInput): Promise<MutationResult>;
  sendCallDtmf(callId: string, sequence: string): Promise<MutationResult>;
  startCallAnnouncement(callId: string, url: string): Promise<MutationResult>;
  sendFax(input: SendFaxInput): Promise<MutationResult>;
  resendFax(input: ResendFaxInput): Promise<MutationResult>;
}
