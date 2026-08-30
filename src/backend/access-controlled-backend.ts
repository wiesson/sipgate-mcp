import type {
  AddressUpdateInput,
  AccessScope,
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
  JsonObject,
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
} from "./telephony-backend.js";

export class AccessPolicyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AccessPolicyError";
  }
}

interface OwnedNumbers {
  numberIds: Set<string>;
  phoneNumbers: Set<string>;
  addressIds: Set<string>;
}

function asObject(value: JsonValue | undefined): JsonObject | undefined {
  return value && !Array.isArray(value) && typeof value === "object" ? value : undefined;
}

function objectArray(value: JsonValue | undefined): JsonObject[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonObject => Boolean(asObject(item)))
    : [];
}

function stringField(value: JsonObject, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

function stringOrNumberField(value: JsonObject, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" || typeof field === "number" ? String(field) : undefined;
}

function addressIds(value: JsonObject): string[] {
  const direct = ["addressId", "emergencyAddressId"]
    .map((key) => stringOrNumberField(value, key))
    .filter((id): id is string => Boolean(id));
  const addressUrl = stringField(value, "addressUrl");
  const fromUrl = addressUrl?.match(/\/addresses\/(\d+)(?:\/|$)/)?.[1];
  return fromUrl ? [...direct, fromUrl] : direct;
}

function items(value: JsonValue): JsonObject[] {
  return objectArray(asObject(value)?.items);
}

function calls(value: JsonValue): JsonObject[] {
  return objectArray(asObject(value)?.data);
}

function nestedNotificationIds(value: JsonValue): Set<string> {
  const found = new Set<string>();
  const response = asObject(value);
  if (!response) return found;
  for (const category of ["call", "fax", "sms", "voicemail"]) {
    for (const endpoint of objectArray(response[category])) {
      for (const targetType of ["emails", "sms", "reports"]) {
        for (const target of objectArray(endpoint[targetType])) {
          const notificationId = stringField(target, "id");
          if (notificationId) found.add(notificationId);
        }
      }
    }
  }
  return found;
}

function withAccessScope(value: JsonValue, context: AuthenticatedUserContext, scope: AccessScope): JsonValue {
  const object = asObject(value);
  return object
    ? { ...object, accessScope: scope }
    : { value, authenticatedUser: context.identity, accessScope: scope };
}

/**
 * Enforces MCP-level resource boundaries in addition to sipgate's own role and
 * token-scope checks. Account scope is rejected unless sipgate identifies the
 * authenticated user as an administrator.
 */
export class AccessControlledBackend implements TelephonyBackend {
  public constructor(
    private readonly delegate: TelephonyBackend,
    private readonly scope: AccessScope,
    private readonly context: AuthenticatedUserContext,
  ) {}

  public getAuthenticatedUser(): Promise<AuthenticatedUserContext> {
    return Promise.resolve(this.context);
  }

  public async getUser(userId: string): Promise<JsonValue> {
    this.assertUser(userId);
    return this.delegate.getUser(userId);
  }

  public async getAccountInfo(): Promise<JsonValue> {
    if (this.scope === "user") {
      return {
        authenticatedUser: this.context.identity,
        accessScope: this.scope,
      };
    }
    return withAccessScope(await this.delegate.getAccountInfo(), this.context, this.scope);
  }

  public async listUsers(): Promise<JsonValue> {
    if (this.scope === "account") return this.delegate.listUsers();
    const user = await this.delegate.getUser(this.context.userId);
    return { items: [user] };
  }

  public async listNumbers({ offset, limit }: PaginationInput): Promise<JsonValue> {
    if (this.scope === "account") return this.delegate.listNumbers({ offset, limit });
    return this.delegate.listUserNumbers(this.context.userId, { offset, limit });
  }

  public listUserNumbers(userId: string, pagination: PaginationInput): Promise<JsonValue> {
    this.assertUser(userId);
    return this.delegate.listUserNumbers(userId, pagination);
  }

  public getUserNumbers(userId: string): Promise<JsonValue> {
    this.assertUser(userId);
    return this.delegate.getUserNumbers(userId);
  }

  public listPhonelines(userId: string): Promise<JsonValue> {
    this.assertUser(userId);
    return this.delegate.listPhonelines(userId);
  }

  public listDevices(userId?: string, types?: DeviceType[]): Promise<JsonValue> {
    if (this.scope === "account") return this.delegate.listDevices(userId, types);
    this.assertUser(userId);
    return this.delegate.listDevices(this.context.userId, types);
  }

  public async getDevice(deviceId: string): Promise<JsonValue> {
    if (this.scope === "user") await this.assertOwnedDevice(deviceId);
    return this.delegate.getDevice(deviceId);
  }

  public async getDeviceCallerId(deviceId: string): Promise<JsonValue> {
    if (this.scope === "user") await this.assertOwnedDevice(deviceId);
    return this.delegate.getDeviceCallerId(deviceId);
  }

  public async getDeviceLocalPrefix(deviceId: string): Promise<JsonValue> {
    if (this.scope === "user") await this.assertOwnedDevice(deviceId);
    return this.delegate.getDeviceLocalPrefix(deviceId);
  }

  public async getDeviceTariffAnnouncement(deviceId: string): Promise<JsonValue> {
    if (this.scope === "user") await this.assertOwnedDevice(deviceId);
    return this.delegate.getDeviceTariffAnnouncement(deviceId);
  }

  public async getDeviceSingleRowDisplay(deviceId: string): Promise<JsonValue> {
    if (this.scope === "user") await this.assertOwnedDevice(deviceId);
    return this.delegate.getDeviceSingleRowDisplay(deviceId);
  }

  public async getDeviceContingents(userId: string, deviceId: string): Promise<JsonValue> {
    if (this.scope === "user") {
      this.assertUser(userId);
      await this.assertOwnedDevice(deviceId);
    }
    return this.delegate.getDeviceContingents(userId, deviceId);
  }

  public async listAddresses(): Promise<JsonValue> {
    const response = await this.delegate.listAddresses();
    if (this.scope === "account") return response;
    const candidates = items(response);
    try {
      const candidateIds = candidates
        .map((address) => stringOrNumberField(address, "addressId"))
        .filter((value): value is string => Boolean(value && /^\d+$/.test(value)))
        .map(Number);
      const ownedIds = await this.ownedAddressIdsFor(candidateIds);
      return {
        items: candidates.filter((address) => {
          const value = stringOrNumberField(address, "addressId");
          return value !== undefined && ownedIds.has(value);
        }),
      };
    } catch {
      throw new AccessPolicyError(
        "User scope could not establish ownership of the account's addresses.",
      );
    }
  }

  public async getAddress(addressId: number): Promise<JsonValue> {
    if (this.scope === "user") await this.assertOwnedAddress(addressId);
    return this.delegate.getAddress(addressId);
  }

  public async listAddressNumbers(addressId: number): Promise<JsonValue> {
    if (this.scope === "account") return this.delegate.listAddressNumbers(addressId);
    await this.assertOwnedAddress(addressId);
    // An address can be shared with numbers belonging to other users. Ownership
    // of one number must not expose the rest of them.
    const numbers = await this.ownedNumbers();
    const response = await this.delegate.listAddressNumbers(addressId);
    return {
      items: items(response).filter((number) => this.isOwnedNumber(number, numbers)),
    };
  }

  public validateQuickDialNumber(quickDialNumber: string): Promise<JsonValue> {
    return this.delegate.validateQuickDialNumber(quickDialNumber);
  }

  public getRouting(userId?: string): Promise<JsonValue> {
    if (this.scope === "account") return this.delegate.getRouting(userId);
    this.assertUser(userId);
    return this.delegate.getRouting(this.context.userId);
  }

  public async getCallHistory(query: HistoryQuery): Promise<JsonValue> {
    if (this.scope === "account") return this.delegate.getCallHistory(query);
    const connectionIds = await this.ownedConnectionIds();
    const requested = query.connectionIds;
    if (requested) {
      for (const connectionId of requested) {
        this.assertOwned(connectionIds, connectionId, "connection");
      }
    }
    const scopedConnectionIds = requested ?? [...connectionIds];
    if (scopedConnectionIds.length === 0) {
      return {
        items: [],
        pagination: {
          offset: query.offset,
          limit: query.limit,
          totalCount: 0,
          nextOffset: null,
        },
      };
    }
    return this.delegate.getCallHistory({ ...query, connectionIds: scopedConnectionIds });
  }

  public async listCalls(): Promise<JsonValue> {
    if (this.scope === "account") return this.delegate.listCalls();
    try {
      const [response, deviceIds, numbers] = await Promise.all([
        this.delegate.listCalls(),
        this.ownedDeviceIds(),
        this.ownedNumbers(),
      ]);
      return {
        data: calls(response).filter((call) => this.isOwnedCall(call, deviceIds, numbers)),
      };
    } catch (error) {
      if (error instanceof AccessPolicyError) throw error;
      throw new AccessPolicyError(
        "User scope could not establish ownership of the account's active calls.",
      );
    }
  }

  public listNotifications(userId: string): Promise<JsonValue> {
    this.assertUser(userId);
    return this.delegate.listNotifications(userId);
  }

  public listFaxlines(userId: string): Promise<JsonValue> {
    this.assertUser(userId);
    return this.delegate.listFaxlines(userId);
  }

  public async listFaxlineNumbers(userId: string, faxlineId: string): Promise<JsonValue> {
    this.assertUser(userId);
    if (this.scope === "user") await this.assertOwnedFaxline(faxlineId);
    return this.delegate.listFaxlineNumbers(userId, faxlineId);
  }

  public async getHistoryEntry(entryId: string): Promise<JsonValue> {
    if (this.scope === "user") await this.assertOwnedHistoryEntry(entryId);
    return this.delegate.getHistoryEntry(entryId);
  }

  public getSettings(userId?: string): Promise<JsonValue> {
    if (this.scope === "account") return this.delegate.getSettings(userId);
    this.assertUser(userId);
    return this.delegate.getSettings(this.context.userId);
  }

  public async setNumberRouting(numberId: string, endpointId: string): Promise<MutationResult> {
    if (this.scope === "user") {
      try {
        // Accounts without a phoneline layer route numbers straight to a
        // device, so an owned device is a legitimate destination endpoint.
        const [numbers, endpointIds] = await Promise.all([
          this.ownedNumbers(),
          this.ownedConnectionIds(),
        ]);
        this.assertOwned(numbers.numberIds, numberId, "phone number");
        this.assertOwned(endpointIds, endpointId, "destination endpoint");
      } catch (error) {
        if (error instanceof AccessPolicyError) throw error;
        throw new AccessPolicyError(
          "User scope could not establish ownership of the requested number or destination endpoint.",
        );
      }
    }
    return this.scope === "user"
      ? this.delegate.setUserNumberRouting(this.context.userId, numberId, endpointId)
      : this.delegate.setNumberRouting(numberId, endpointId);
  }

  public setUserNumberRouting(
    userId: string,
    numberId: string,
    endpointId: string,
  ): Promise<MutationResult> {
    this.assertUser(userId);
    return this.setNumberRouting(numberId, endpointId);
  }

  public async setForwarding(
    userId: string,
    phonelineId: string,
    forwardings: ForwardingRule[],
  ): Promise<MutationResult> {
    if (this.scope === "user") {
      this.assertUser(userId);
      try {
        this.assertOwned(await this.ownedPhonelineIds(), phonelineId, "phoneline");
      } catch (error) {
        if (error instanceof AccessPolicyError) throw error;
        throw new AccessPolicyError(
          "User scope could not establish ownership of the requested phoneline.",
        );
      }
    }
    return this.delegate.setForwarding(userId, phonelineId, forwardings);
  }

  public async setDnd(deviceId: string, enabled: boolean): Promise<MutationResult> {
    if (this.scope === "user") await this.assertOwnedDevice(deviceId);
    return this.delegate.setDnd(deviceId, enabled);
  }

  public async updateDevice(
    deviceId: string,
    settings: DeviceSettingsInput,
  ): Promise<MutationResult> {
    if (this.scope === "user") {
      await this.assertOwnedDevice(deviceId);
      if (settings.emergencyAddressId !== undefined) {
        await this.assertOwnedAddress(settings.emergencyAddressId);
      }
    }
    return this.delegate.updateDevice(deviceId, settings);
  }

  public async deleteDevice(deviceId: string): Promise<MutationResult> {
    if (this.scope === "user") await this.assertOwnedDevice(deviceId);
    return this.delegate.deleteDevice(deviceId);
  }

  public async setDeviceAlias(deviceId: string, value?: string): Promise<MutationResult> {
    if (this.scope === "user") await this.assertOwnedDevice(deviceId);
    return this.delegate.setDeviceAlias(deviceId, value);
  }

  public async setDeviceCallerId(deviceId: string, value?: string): Promise<MutationResult> {
    if (this.scope === "user") {
      await this.assertOwnedDevice(deviceId);
      if (value !== undefined) {
        await this.assertOwnedPhoneNumber(value, "caller ID phone number");
      }
    }
    return this.delegate.setDeviceCallerId(deviceId, value);
  }

  public async setDeviceLocalPrefix(
    deviceId: string,
    input: LocalPrefixInput,
  ): Promise<MutationResult> {
    if (this.scope === "user") await this.assertOwnedDevice(deviceId);
    return this.delegate.setDeviceLocalPrefix(deviceId, input);
  }

  public async setDeviceTariffAnnouncement(
    deviceId: string,
    enabled?: boolean,
  ): Promise<MutationResult> {
    if (this.scope === "user") await this.assertOwnedDevice(deviceId);
    return this.delegate.setDeviceTariffAnnouncement(deviceId, enabled);
  }

  public async setDeviceSingleRowDisplay(
    deviceId: string,
    enabled?: boolean,
  ): Promise<MutationResult> {
    if (this.scope === "user") await this.assertOwnedDevice(deviceId);
    return this.delegate.setDeviceSingleRowDisplay(deviceId, enabled);
  }

  public async setExternalDeviceTargetNumber(
    deviceId: string,
    number?: string,
  ): Promise<MutationResult> {
    if (this.scope === "user") await this.assertOwnedDevice(deviceId);
    return this.delegate.setExternalDeviceTargetNumber(deviceId, number);
  }

  public async setExternalDeviceIncomingCallDisplay(
    deviceId: string,
    incomingCallDisplay: "CALLED_NUMBER" | "CALLER_NUMBER",
  ): Promise<MutationResult> {
    if (this.scope === "user") await this.assertOwnedDevice(deviceId);
    return this.delegate.setExternalDeviceIncomingCallDisplay(deviceId, incomingCallDisplay);
  }

  public async changeDevicePassword(deviceId: string): Promise<MutationResult> {
    if (this.scope === "user") await this.assertOwnedDevice(deviceId);
    return this.delegate.changeDevicePassword(deviceId);
  }

  public createRegisterDevice(userId: string, alias?: string): Promise<MutationResult> {
    this.assertUser(userId);
    return this.delegate.createRegisterDevice(userId, alias);
  }

  public createMobileDevice(userId: string, alias?: string): Promise<MutationResult> {
    this.assertUser(userId);
    return this.delegate.createMobileDevice(userId, alias);
  }

  public createExternalDevice(
    userId: string,
    alias?: string,
    number?: string,
  ): Promise<MutationResult> {
    this.assertUser(userId);
    return this.delegate.createExternalDevice(userId, alias, number);
  }

  public createQuickDial(input: QuickDialInput): Promise<MutationResult> {
    this.assertUser(input.userId);
    return this.delegate.createQuickDial(input);
  }

  public async updateQuickDial(
    quickDialId: string,
    input: QuickDialInput,
  ): Promise<MutationResult> {
    if (this.scope === "user") {
      this.assertUser(input.userId);
      await this.assertOwnedNumberId(quickDialId, "quick-dial number");
    }
    return this.delegate.updateQuickDial(quickDialId, input);
  }

  public async deleteQuickDial(numberId: string): Promise<MutationResult> {
    if (this.scope === "user") {
      await this.assertOwnedNumberId(numberId, "quick-dial number");
    }
    return this.delegate.deleteQuickDial(numberId);
  }

  public async updateAddress(
    addressId: number,
    input: AddressUpdateInput,
  ): Promise<MutationResult> {
    if (this.scope === "user") {
      await this.assertOwnedAddress(addressId);
      await this.assertExclusivelyOwnedAddress(addressId);
    }
    return this.delegate.updateAddress(addressId, input);
  }

  public async sendSms(input: {
    userId: string;
    smsId?: string;
    recipient: string;
    message: string;
    sendAt?: number;
  }): Promise<MutationResult> {
    if (this.scope === "user") this.assertUser(input.userId);
    return this.delegate.sendSms(input);
  }

  public async initiateCall(input: {
    caller: string;
    callee: string;
    callerId?: string;
    deviceId?: string;
  }): Promise<MutationResult> {
    if (this.scope === "user") {
      try {
        const [numbers, deviceIds] = await Promise.all([
          this.ownedNumbers(),
          this.ownedDeviceIds(),
        ]);
        const callerIsOwned = deviceIds.has(input.caller)
          || numbers.phoneNumbers.has(input.caller);
        if (!callerIsOwned) {
          throw new AccessPolicyError(
            "User scope only permits calls from the authenticated user's devices or phone numbers.",
          );
        }
        if (input.deviceId) this.assertOwned(deviceIds, input.deviceId, "device");
        if (input.callerId) this.assertOwned(numbers.phoneNumbers, input.callerId, "caller ID");
      } catch (error) {
        if (error instanceof AccessPolicyError) throw error;
        throw new AccessPolicyError(
          "User scope could not establish ownership of the requested call origin.",
        );
      }
    }
    return this.scope === "user"
      ? this.delegate.initiateUserCall(input)
      : this.delegate.initiateCall(input);
  }

  public initiateUserCall(input: {
    caller: string;
    callee: string;
    callerId?: string;
    deviceId?: string;
  }): Promise<MutationResult> {
    if (this.scope === "account") return this.delegate.initiateUserCall(input);
    return this.initiateCall(input);
  }

  public async createCallEmailNotification(
    input: CallEmailNotificationInput,
  ): Promise<MutationResult> {
    this.assertUser(input.userId);
    if (this.scope === "user") await this.assertOwnedConnectionId(input.endpointId);
    return this.delegate.createCallEmailNotification(input);
  }

  public async createCallSmsNotification(
    input: CallSmsNotificationInput,
  ): Promise<MutationResult> {
    this.assertUser(input.userId);
    if (this.scope === "user") await this.assertOwnedConnectionId(input.endpointId);
    return this.delegate.createCallSmsNotification(input);
  }

  public async createFaxEmailNotification(
    input: FaxEmailNotificationInput,
  ): Promise<MutationResult> {
    this.assertUser(input.userId);
    if (this.scope === "user") await this.assertOwnedFaxline(input.faxlineId);
    return this.delegate.createFaxEmailNotification(input);
  }

  public async createFaxSmsNotification(
    input: FaxSmsNotificationInput,
  ): Promise<MutationResult> {
    this.assertUser(input.userId);
    if (this.scope === "user") await this.assertOwnedFaxline(input.faxlineId);
    return this.delegate.createFaxSmsNotification(input);
  }

  public async createFaxReportNotification(
    input: FaxReportNotificationInput,
  ): Promise<MutationResult> {
    this.assertUser(input.userId);
    if (this.scope === "user") await this.assertOwnedFaxline(input.faxlineId);
    return this.delegate.createFaxReportNotification(input);
  }

  public createSmsEmailNotification(input: SmsEmailNotificationInput): Promise<MutationResult> {
    this.assertUser(input.userId);
    return this.delegate.createSmsEmailNotification(input);
  }

  public createVoicemailEmailNotification(
    input: VoicemailEmailNotificationInput,
  ): Promise<MutationResult> {
    this.assertUser(input.userId);
    return this.delegate.createVoicemailEmailNotification(input);
  }

  public createVoicemailSmsNotification(
    input: VoicemailSmsNotificationInput,
  ): Promise<MutationResult> {
    this.assertUser(input.userId);
    return this.delegate.createVoicemailSmsNotification(input);
  }

  public async deleteNotification(
    userId: string,
    notificationId: string,
  ): Promise<MutationResult> {
    this.assertUser(userId);
    if (this.scope === "user") {
      try {
        const ownedIds = nestedNotificationIds(await this.delegate.listNotifications(userId));
        this.assertOwned(ownedIds, notificationId, "notification");
      } catch (error) {
        if (error instanceof AccessPolicyError) throw error;
        throw new AccessPolicyError(
          "User scope could not establish ownership of the requested notification.",
        );
      }
    }
    return this.delegate.deleteNotification(userId, notificationId);
  }

  public async hangupCall(callId: string): Promise<MutationResult> {
    if (this.scope === "user") await this.assertOwnedCall(callId);
    return this.delegate.hangupCall(callId);
  }

  public async setCallHold(callId: string, value: boolean): Promise<MutationResult> {
    if (this.scope === "user") await this.assertOwnedCall(callId);
    return this.delegate.setCallHold(callId, value);
  }

  public async setCallMuted(callId: string, value: boolean): Promise<MutationResult> {
    if (this.scope === "user") await this.assertOwnedCall(callId);
    return this.delegate.setCallMuted(callId, value);
  }

  public async setCallRecording(
    callId: string,
    value: boolean,
    announcement?: boolean,
  ): Promise<MutationResult> {
    if (this.scope === "user") await this.assertOwnedCall(callId);
    return this.delegate.setCallRecording(callId, value, announcement);
  }

  public async transferCall(
    callId: string,
    input: CallTransferInput,
  ): Promise<MutationResult> {
    if (this.scope === "user") {
      await this.assertOwnedCall(callId);
      if (input.callerId !== undefined) {
        await this.assertOwnedPhoneNumber(input.callerId, "transfer caller ID phone number");
      }
    }
    return this.delegate.transferCall(callId, input);
  }

  public async sendCallDtmf(callId: string, sequence: string): Promise<MutationResult> {
    if (this.scope === "user") await this.assertOwnedCall(callId);
    return this.delegate.sendCallDtmf(callId, sequence);
  }

  public async startCallAnnouncement(callId: string, url: string): Promise<MutationResult> {
    if (this.scope === "user") await this.assertOwnedCall(callId);
    return this.delegate.startCallAnnouncement(callId, url);
  }

  public async sendFax(input: SendFaxInput): Promise<MutationResult> {
    if (this.scope === "user") await this.assertOwnedFaxline(input.faxlineId);
    return this.delegate.sendFax(input);
  }

  public async resendFax(input: ResendFaxInput): Promise<MutationResult> {
    if (this.scope === "user") {
      if (!input.faxlineId) {
        throw new AccessPolicyError(
          "User scope requires a faxline ID to establish ownership before resending a fax.",
        );
      }
      await this.assertOwnedFaxline(input.faxlineId);
      await this.assertOwnedHistoryEntry(input.faxId);
    }
    return this.delegate.resendFax(input);
  }

  /**
   * A fax ID is a history entry. Resending one that belongs to another user
   * would retransmit their document and bill it, so the entry's connection must
   * be one the authenticated user owns.
   */
  private async assertOwnedHistoryEntry(entryId: string): Promise<void> {
    let connectionIds: Set<string>;
    let entry: JsonObject | undefined;
    try {
      [connectionIds, entry] = await Promise.all([
        this.ownedConnectionIds(),
        this.delegate.getHistoryEntry(entryId).then((value) => asObject(value)),
      ]);
    } catch {
      throw new AccessPolicyError(
        "User scope could not establish ownership of the requested history entry.",
      );
    }
    const entryConnections = Array.isArray(entry?.connectionIds)
      ? entry.connectionIds.filter((value): value is string => typeof value === "string")
      : [];
    if (entryConnections.some((connectionId) => connectionIds.has(connectionId))) return;
    throw new AccessPolicyError(
      "User scope does not permit access to the requested history entry.",
    );
  }

  private assertUser(userId: string | undefined): void {
    if (this.scope === "account" || userId === undefined || userId === this.context.userId) return;
    throw new AccessPolicyError(
      `User scope is restricted to the authenticated sipgate user ${this.context.userId}.`,
    );
  }

  private assertOwned(allowed: Set<string>, value: string, resource: string): void {
    if (allowed.has(value)) return;
    throw new AccessPolicyError(
      `User scope does not permit access to the requested ${resource}.`,
    );
  }

  private async ownedConnectionIds(): Promise<Set<string>> {
    const [phonelineIds, deviceIds] = await Promise.all([
      this.ownedPhonelineIds(),
      this.ownedDeviceIds(),
    ]);
    return new Set([...phonelineIds, ...deviceIds]);
  }

  private async assertOwnedConnectionId(connectionId: string): Promise<void> {
    try {
      this.assertOwned(await this.ownedConnectionIds(), connectionId, "notification endpoint");
    } catch (error) {
      if (error instanceof AccessPolicyError) throw error;
      throw new AccessPolicyError(
        "User scope could not establish ownership of the requested notification endpoint.",
      );
    }
  }

  private async assertOwnedFaxline(faxlineId: string): Promise<void> {
    try {
      const response = await this.delegate.listFaxlines(this.context.userId);
      const faxlineIds = new Set(
        items(response)
          .map((faxline) => stringField(faxline, "id"))
          .filter((id): id is string => Boolean(id)),
      );
      this.assertOwned(faxlineIds, faxlineId, "faxline");
    } catch (error) {
      if (error instanceof AccessPolicyError) throw error;
      throw new AccessPolicyError(
        "User scope could not establish ownership of the requested faxline.",
      );
    }
  }

  private async assertOwnedCall(callId: string): Promise<void> {
    try {
      const [response, deviceIds, numbers] = await Promise.all([
        this.delegate.listCalls(),
        this.ownedDeviceIds(),
        this.ownedNumbers(),
      ]);
      const call = calls(response).find((candidate) => stringField(candidate, "callId") === callId);
      if (call && this.isOwnedCall(call, deviceIds, numbers)) return;
      throw new AccessPolicyError(
        "User scope does not permit access to the requested active call.",
      );
    } catch (error) {
      if (error instanceof AccessPolicyError) throw error;
      throw new AccessPolicyError(
        "User scope could not establish ownership of the requested active call.",
      );
    }
  }

  private isOwnedCall(
    call: JsonObject,
    deviceIds: Set<string>,
    numbers: OwnedNumbers,
  ): boolean {
    // Being a participant in someone else's call is not ownership: the remote
    // party of a foreign call carries an owned number too. Only the participant
    // sipgate marks as the call owner counts, and an unmarked call fails closed.
    const owner = objectArray(call.participants)
      .find((participant) => participant.owner === true);
    if (!owner) return false;
    const participantId = stringField(owner, "participantId");
    const phoneNumber = stringField(owner, "phoneNumber");
    return (participantId !== undefined && deviceIds.has(participantId))
      || (phoneNumber !== undefined && numbers.phoneNumbers.has(phoneNumber));
  }

  private async ownedPhonelineIds(): Promise<Set<string>> {
    const phonelinesResponse = await this.delegate.listPhonelines(this.context.userId);
    return new Set(
      items(phonelinesResponse)
        .map((phoneline) => stringField(phoneline, "id"))
        .filter((id): id is string => Boolean(id)),
    );
  }

  private async ownedDeviceIds(): Promise<Set<string>> {
    const devicesResponse = await this.delegate.listDevices(this.context.userId);
    return new Set(
      items(devicesResponse)
        .map((device) => stringField(device, "id"))
        .filter((id): id is string => Boolean(id)),
    );
  }

  private async assertOwnedDevice(deviceId: string): Promise<void> {
    try {
      this.assertOwned(await this.ownedDeviceIds(), deviceId, "device");
    } catch (error) {
      if (error instanceof AccessPolicyError) throw error;
      throw new AccessPolicyError(
        "User scope could not establish ownership of the requested device.",
      );
    }
  }

  private async assertOwnedNumberId(numberId: string, resource: string): Promise<void> {
    try {
      this.assertOwned((await this.ownedNumbers()).numberIds, numberId, resource);
    } catch (error) {
      if (error instanceof AccessPolicyError) throw error;
      throw new AccessPolicyError(
        `User scope could not establish ownership of the requested ${resource}.`,
      );
    }
  }

  private async assertOwnedPhoneNumber(phoneNumber: string, resource: string): Promise<void> {
    try {
      this.assertOwned((await this.ownedNumbers()).phoneNumbers, phoneNumber, resource);
    } catch (error) {
      if (error instanceof AccessPolicyError) throw error;
      throw new AccessPolicyError(
        `User scope could not establish ownership of the requested ${resource}.`,
      );
    }
  }

  private async assertOwnedAddress(addressId: number): Promise<void> {
    try {
      if (await this.isOwnedAddress(addressId)) return;
    } catch {
      // Ownership lookup failures are deliberately exposed as policy denials.
    }
    throw new AccessPolicyError(
      "User scope does not permit access to the requested address because ownership could not be established.",
    );
  }

  private async isOwnedAddress(addressId: number): Promise<boolean> {
    return (await this.ownedAddressIdsFor([addressId])).has(String(addressId));
  }

  private async ownedAddressIdsFor(addressIdsToCheck: number[]): Promise<Set<string>> {
    if (addressIdsToCheck.length === 0) return new Set();
    const expected = new Set(addressIdsToCheck.map(String));
    const [numbers, devicesResponse] = await Promise.all([
      this.ownedNumbers(),
      this.delegate.listDevices(this.context.userId),
    ]);
    const owned = new Set([...numbers.addressIds].filter((addressId) => expected.has(addressId)));

    const devices = items(devicesResponse);
    for (const device of devices) {
      for (const addressId of addressIds(device)) {
        if (expected.has(addressId)) owned.add(addressId);
      }
    }

    const detailedDevices = await Promise.allSettled(devices.map(async (device) => {
      const deviceId = stringField(device, "id");
      return deviceId ? this.delegate.getDevice(deviceId) : undefined;
    }));
    for (const result of detailedDevices) {
      if (result.status !== "fulfilled") continue;
      const device = asObject(result.value);
      if (!device) continue;
      for (const addressId of addressIds(device)) {
        if (expected.has(addressId)) owned.add(addressId);
      }
    }

    const unresolved = addressIdsToCheck.filter((addressId) => !owned.has(String(addressId)));
    const addressNumberResponses = await Promise.all(unresolved.map(async (addressId) => ({
      addressId: String(addressId),
      response: await this.delegate.listAddressNumbers(addressId),
    })));
    for (const { addressId, response } of addressNumberResponses) {
      const containsOwnedNumber = items(response).some((number) => {
        const numberId = stringField(number, "id");
        const phoneNumber = stringField(number, "number");
        return (numberId !== undefined && numbers.numberIds.has(numberId))
          || (phoneNumber !== undefined && numbers.phoneNumbers.has(phoneNumber));
      });
      if (containsOwnedNumber) owned.add(addressId);
    }
    return owned;
  }

  private isOwnedNumber(number: JsonObject, numbers: OwnedNumbers): boolean {
    const numberId = stringField(number, "id");
    const phoneNumber = stringField(number, "number");
    return (numberId !== undefined && numbers.numberIds.has(numberId))
      || (phoneNumber !== undefined && numbers.phoneNumbers.has(phoneNumber));
  }

  /**
   * Editing an address rewrites it for every number attached to it, so a
   * user-scope write is only safe when the user owns all of them.
   */
  private async assertExclusivelyOwnedAddress(addressId: number): Promise<void> {
    const [numbers, response] = await Promise.all([
      this.ownedNumbers(),
      this.delegate.listAddressNumbers(addressId),
    ]);
    const attached = items(response);
    const foreign = attached.filter((number) => !this.isOwnedNumber(number, numbers));
    if (foreign.length === 0) return;
    throw new AccessPolicyError(
      "User scope does not permit editing an address that is shared with numbers of other users.",
    );
  }

  private async ownedNumbers(): Promise<OwnedNumbers> {
    const pageSize = 1000;
    const routed: JsonObject[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const page = items(await this.delegate.listUserNumbers(
        this.context.userId,
        { offset, limit: pageSize },
      ));
      routed.push(...page);
      if (page.length < pageSize) break;
    }
    // Quick dials and other number types are listed by the direct user-number
    // endpoint but may never appear in phoneline or device routing.
    const direct = items(await this.delegate.getUserNumbers(this.context.userId));
    const numbers = [...routed, ...direct];
    return {
      numberIds: new Set(
        numbers.map((number) => stringField(number, "id")).filter((id): id is string => Boolean(id)),
      ),
      phoneNumbers: new Set(
        numbers.map((number) => stringField(number, "number")).filter((number): number is string => Boolean(number)),
      ),
      addressIds: new Set(
        numbers.flatMap((number) => addressIds(number)),
      ),
    };
  }
}

export async function createAccessControlledBackend(
  delegate: TelephonyBackend,
  scope: AccessScope,
): Promise<AccessControlledBackend> {
  const context = await delegate.getAuthenticatedUser();
  if (scope === "account") {
    const user = asObject(await delegate.getUser(context.userId));
    if (user?.admin !== true) {
      throw new AccessPolicyError(
        "Account scope requires the authenticated sipgate user to be an administrator.",
      );
    }
  }
  return new AccessControlledBackend(delegate, scope, context);
}
