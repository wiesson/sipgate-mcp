export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

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

export interface TelephonyBackend {
  getAccountInfo(): Promise<JsonValue>;
  listUsers(): Promise<JsonValue>;
  listNumbers(pagination: PaginationInput): Promise<JsonValue>;
  listDevices(userId?: string, types?: DeviceType[]): Promise<JsonValue>;
  getRouting(userId?: string): Promise<JsonValue>;
  getCallHistory(query: HistoryQuery): Promise<JsonValue>;
  getSettings(userId?: string): Promise<JsonValue>;
  setNumberRouting(numberId: string, endpointId: string): Promise<MutationResult>;
  setForwarding(
    userId: string,
    phonelineId: string,
    forwardings: ForwardingRule[],
  ): Promise<MutationResult>;
  setDnd(deviceId: string, enabled: boolean): Promise<MutationResult>;
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
}
