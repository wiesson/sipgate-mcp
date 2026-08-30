import type {
  AccessScope,
  AuthenticatedUserContext,
  DeviceType,
  ForwardingRule,
  HistoryQuery,
  JsonObject,
  JsonValue,
  MutationResult,
  PaginationInput,
  TelephonyBackend,
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

function items(value: JsonValue): JsonObject[] {
  return objectArray(asObject(value)?.items);
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

  public listPhonelines(userId: string): Promise<JsonValue> {
    this.assertUser(userId);
    return this.delegate.listPhonelines(userId);
  }

  public listDevices(userId?: string, types?: DeviceType[]): Promise<JsonValue> {
    if (this.scope === "account") return this.delegate.listDevices(userId, types);
    this.assertUser(userId);
    return this.delegate.listDevices(this.context.userId, types);
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

  public getSettings(userId?: string): Promise<JsonValue> {
    if (this.scope === "account") return this.delegate.getSettings(userId);
    this.assertUser(userId);
    return this.delegate.getSettings(this.context.userId);
  }

  public async setNumberRouting(numberId: string, endpointId: string): Promise<MutationResult> {
    if (this.scope === "user") {
      const [numbers, phonelineIds] = await Promise.all([
        this.ownedNumbers(),
        this.ownedPhonelineIds(),
      ]);
      this.assertOwned(numbers.numberIds, numberId, "phone number");
      this.assertOwned(phonelineIds, endpointId, "destination phoneline");
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
      this.assertOwned(await this.ownedPhonelineIds(), phonelineId, "phoneline");
    }
    return this.delegate.setForwarding(userId, phonelineId, forwardings);
  }

  public async setDnd(deviceId: string, enabled: boolean): Promise<MutationResult> {
    if (this.scope === "user") {
      this.assertOwned(await this.ownedDeviceIds(), deviceId, "device");
    }
    return this.delegate.setDnd(deviceId, enabled);
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

  private async ownedNumbers(): Promise<OwnedNumbers> {
    const numbersResponse = await this.delegate.listUserNumbers(
      this.context.userId,
      { offset: 0, limit: 1000 },
    );
    const numbers = items(numbersResponse);
    return {
      numberIds: new Set(
        numbers.map((number) => stringField(number, "id")).filter((id): id is string => Boolean(id)),
      ),
      phoneNumbers: new Set(
        numbers.map((number) => stringField(number, "number")).filter((number): number is string => Boolean(number)),
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
