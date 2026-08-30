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
}
