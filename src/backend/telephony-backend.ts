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
export type DeviceType = "all" | "app" | "register" | "mobile" | "external";

export interface PaginationInput {
  offset: number;
  limit: number;
}

export interface HistoryQuery extends PaginationInput {
  directions?: HistoryDirection[];
  from?: string;
  to?: string;
  phoneNumber?: string;
  types?: HistoryType[];
  connectionIds?: string[];
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

export interface TelephonyBackend {
  getAuthenticatedUser(): Promise<AuthenticatedUserContext>;
  getUser(userId: string): Promise<JsonValue>;
  getAccountInfo(): Promise<JsonValue>;
  listUsers(): Promise<JsonValue>;
  listNumbers(pagination: PaginationInput): Promise<JsonValue>;
  listUserNumbers(userId: string, pagination: PaginationInput): Promise<JsonValue>;
  getUserNumbers(userId: string): Promise<JsonValue>;
  listPhonelines(userId: string): Promise<JsonValue>;
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
  getRouting(userId?: string): Promise<JsonValue>;
  getCallHistory(query: HistoryQuery): Promise<JsonValue>;
  listCalls(): Promise<JsonValue>;
  listNotifications(userId: string): Promise<JsonValue>;
  listFaxlines(userId: string): Promise<JsonValue>;
  listFaxlineNumbers(userId: string, faxlineId: string): Promise<JsonValue>;
  getSettings(userId?: string): Promise<JsonValue>;
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
