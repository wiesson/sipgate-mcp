import { SipgateApiError, SipgateClient } from "./sipgate-client.js";
import type {
  AddressUpdateInput,
  AuthenticatedUserContext,
  DeviceSettingsInput,
  DeviceType,
  ForwardingRule,
  HistoryQuery,
  JsonObject,
  JsonValue,
  LocalPrefixInput,
  MutationResult,
  PaginationInput,
  QuickDialInput,
  TelephonyBackend,
} from "./telephony-backend.js";

interface ItemsResponse {
  items?: JsonObject[];
  totalCount?: number;
}

const SENSITIVE_KEY = /authorization|credential|password|secret|token/i;

function sanitize(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitize(child)]),
    );
  }
  return String(value);
}

function asItems(value: JsonValue | undefined): JsonObject[] {
  if (!value || Array.isArray(value) || typeof value !== "object") return [];
  const items = (value as ItemsResponse).items;
  return Array.isArray(items) ? items : [];
}

function stringField(value: JsonObject, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

function encodeId(id: string): string {
  return encodeURIComponent(id);
}

/**
 * sipgate answers 403/404 for endpoints an account does not provide. Newer
 * accounts have no phoneline layer at all: their numbers hang directly off a
 * device. Treat those statuses as "feature absent" instead of a hard failure so
 * a missing phoneline layer cannot take down number, history, and settings
 * lookups that can be served from devices instead.
 */
const UNAVAILABLE_STATUS = new Set([403, 404]);

interface OptionalResult<T> {
  value?: T;
  available: boolean;
}

async function optional<T>(request: Promise<T>): Promise<OptionalResult<T>> {
  try {
    return { value: await request, available: true };
  } catch (error) {
    if (
      error instanceof SipgateApiError
      && error.status !== undefined
      && UNAVAILABLE_STATUS.has(error.status)
    ) {
      return { available: false };
    }
    throw error;
  }
}

function idSet(items: JsonObject[]): Set<string> {
  return new Set(
    items.map((item) => stringField(item, "id")).filter((id): id is string => Boolean(id)),
  );
}

export class SipgateBackend implements TelephonyBackend {
  public constructor(private readonly client: SipgateClient) {}

  public async getAuthenticatedUser(): Promise<AuthenticatedUserContext> {
    const response = await this.client.request<JsonValue>("/authorization/userinfo");
    if (!response || Array.isArray(response) || typeof response !== "object") {
      throw new SipgateApiError("sipgate did not return an authenticated user identity.");
    }
    const userId = stringField(response, "sub");
    if (!userId) {
      throw new SipgateApiError("sipgate did not return an ID for the authenticated user.");
    }
    return { identity: sanitize(response) as JsonObject, userId };
  }

  public async getUser(userId: string): Promise<JsonValue> {
    const response = await this.client.request<JsonValue>(`/users/${encodeId(userId)}`);
    return sanitize(response ?? {});
  }

  public async getAccountInfo(): Promise<JsonValue> {
    const [account, authenticatedUser] = await Promise.all([
      this.client.request<JsonValue>("/account"),
      this.getAuthenticatedUser(),
    ]);
    return sanitize({ account, authenticatedUser: authenticatedUser.identity });
  }

  public async listUsers(): Promise<JsonValue> {
    const response = await this.client.request<JsonValue>("/users");
    return sanitize(response ?? { items: [] });
  }

  public async listNumbers({ offset, limit }: PaginationInput): Promise<JsonValue> {
    const response = await this.client.request<JsonValue>("/numbers", { query: { offset, limit } });
    const items = asItems(response);
    return sanitize({ items, pagination: { offset, limit, returned: items.length } });
  }

  public async listPhonelines(userId: string): Promise<JsonValue> {
    const { value, available } = await this.tryListPhonelines(userId);
    if (!available) return { items: [], phonelinesAvailable: false };
    return sanitize(value ?? { items: [] });
  }

  private tryListPhonelines(userId: string): Promise<OptionalResult<JsonValue>> {
    return optional(this.client.request<JsonValue>(`/${encodeId(userId)}/phonelines`));
  }

  private async listDeviceIds(userId: string): Promise<Set<string>> {
    const response = await this.client.request<JsonValue>(`/${encodeId(userId)}/devices`);
    return idSet(asItems(response));
  }

  /**
   * Fallback for accounts without a phoneline layer: numbers are matched to the
   * user through the device their endpoint points at.
   */
  private async listAllAccountNumbers(): Promise<JsonObject[]> {
    const pageSize = 1000;
    const all: JsonObject[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const response = await this.client.request<JsonValue>("/numbers", {
        query: { offset, limit: pageSize },
      });
      const page = asItems(response);
      all.push(...page);
      const envelope = response && !Array.isArray(response) && typeof response === "object"
        ? response
        : {};
      const totalCount = typeof envelope.totalCount === "number" ? envelope.totalCount : undefined;
      // sipgate may clamp the requested limit, so advance by what it actually
      // returned and stop once a page comes back empty or the count is reached.
      if (page.length === 0) break;
      if (totalCount !== undefined && all.length >= totalCount) break;
      if (page.length < pageSize) break;
    }
    return all;
  }

  private async listDeviceNumbers(
    userId: string,
    { offset, limit }: PaginationInput,
    phonelinesAvailable: boolean,
  ): Promise<JsonValue> {
    const [deviceIds, accountNumbers] = await Promise.all([
      this.listDeviceIds(userId),
      this.listAllAccountNumbers(),
    ]);
    const owned = accountNumbers.filter((number) => {
      const endpointId = stringField(number, "endpointId");
      return endpointId !== undefined && deviceIds.has(endpointId);
    });
    const page = owned.slice(offset, offset + limit);
    return sanitize({
      items: page,
      pagination: { offset, limit, returned: page.length, totalCount: owned.length },
      source: "devices",
      phonelinesAvailable,
    });
  }

  public async listUserNumbers(
    userId: string,
    { offset, limit }: PaginationInput,
  ): Promise<JsonValue> {
    const { value: phonelinesValue, available } = await this.tryListPhonelines(userId);
    const phonelines = asItems(phonelinesValue);
    if (!available || phonelines.length === 0) {
      return this.listDeviceNumbers(userId, { offset, limit }, available);
    }
    const numberGroups = await Promise.all(phonelines.map(async (phoneline) => {
      const phonelineId = stringField(phoneline, "id");
      if (!phonelineId) return [];
      const response = await this.client.request<JsonValue>(
        `/${encodeId(userId)}/phonelines/${encodeId(phonelineId)}/numbers`,
      );
      return asItems(response).map((number) => ({
        ...number,
        endpointId: phonelineId,
        ...(typeof phoneline.alias === "string" ? { endpointAlias: phoneline.alias } : {}),
      }));
    }));
    const uniqueNumbers = [...new Map(numberGroups.flat().map((number) => [
      stringField(number, "id") ?? stringField(number, "number") ?? JSON.stringify(number),
      number,
    ])).values()];
    const page = uniqueNumbers.slice(offset, offset + limit);
    return sanitize({
      items: page,
      pagination: { offset, limit, returned: page.length, totalCount: uniqueNumbers.length },
    });
  }

  public async getUserNumbers(userId: string): Promise<JsonValue> {
    const response = await this.client.request<JsonValue>(`/${encodeId(userId)}/numbers`);
    return sanitize(response ?? { items: [] });
  }

  public async listDevices(userId?: string, types?: DeviceType[]): Promise<JsonValue> {
    const userIds = userId ? [userId] : asItems(await this.client.request<JsonValue>("/users"))
      .map((user) => stringField(user, "id"))
      .filter((id): id is string => Boolean(id));

    const type = types && types.length > 0 ? types.join(",") : undefined;
    const responses = await Promise.all(
      userIds.map(async (id) => ({
        userId: id,
        response: await this.client.request<JsonValue>(`/${encodeId(id)}/devices`, { query: { type } }),
      })),
    );
    const items = responses.flatMap(({ userId: ownerId, response }) =>
      asItems(response).map((device) => ({ ...device, userId: ownerId })),
    );
    return sanitize({ items });
  }

  public async getDevice(deviceId: string): Promise<JsonValue> {
    const response = await this.client.request<JsonValue>(`/devices/${encodeId(deviceId)}`);
    return sanitize(response ?? {});
  }

  public async getDeviceCallerId(deviceId: string): Promise<JsonValue> {
    const response = await this.client.request<JsonValue>(
      `/devices/${encodeId(deviceId)}/callerid`,
    );
    return sanitize(response ?? {});
  }

  public async getDeviceLocalPrefix(deviceId: string): Promise<JsonValue> {
    const response = await this.client.request<JsonValue>(
      `/devices/${encodeId(deviceId)}/localprefix`,
    );
    return sanitize(response ?? {});
  }

  public async getDeviceTariffAnnouncement(deviceId: string): Promise<JsonValue> {
    const response = await this.client.request<JsonValue>(
      `/devices/${encodeId(deviceId)}/tariffannouncement`,
    );
    return sanitize(response ?? {});
  }

  public async getDeviceSingleRowDisplay(deviceId: string): Promise<JsonValue> {
    const response = await this.client.request<JsonValue>(
      `/devices/${encodeId(deviceId)}/singlerowdisplay`,
    );
    return sanitize(response ?? {});
  }

  public async getDeviceContingents(userId: string, deviceId: string): Promise<JsonValue> {
    const response = await this.client.request<JsonValue>(
      `/${encodeId(userId)}/devices/${encodeId(deviceId)}/contingents`,
    );
    return sanitize(response ?? { contingents: [] });
  }

  public async listAddresses(): Promise<JsonValue> {
    const response = await this.client.request<JsonValue>("/addresses");
    return sanitize(response ?? { items: [] });
  }

  public async getAddress(addressId: number): Promise<JsonValue> {
    const response = await this.client.request<JsonValue>(`/addresses/${addressId}`);
    return sanitize(response ?? {});
  }

  public async listAddressNumbers(addressId: number): Promise<JsonValue> {
    const response = await this.client.request<JsonValue>(`/addresses/${addressId}/numbers`);
    return sanitize(response ?? { items: [] });
  }

  public async validateQuickDialNumber(quickDialNumber: string): Promise<JsonValue> {
    const response = await this.client.request<JsonValue>(
      `/numbers/quickdial/validation/${encodeId(quickDialNumber)}`,
    );
    return sanitize(response ?? {});
  }

  public async getRouting(userId?: string): Promise<JsonValue> {
    const [numbersResponse, usersResponse] = await Promise.all([
      userId
        ? Promise.resolve(undefined)
        : this.client.request<JsonValue>("/numbers", { query: { offset: 0, limit: 1000 } }),
      userId ? Promise.resolve(undefined) : this.client.request<JsonValue>("/users"),
    ]);
    const userIds = userId ? [userId] : asItems(usersResponse)
      .map((user) => stringField(user, "id"))
      .filter((id): id is string => Boolean(id));

    const users = await Promise.all(userIds.map(async (id) => {
      const phonelinesResult = await this.tryListPhonelines(id);
      const phonelines = await Promise.all(asItems(phonelinesResult.value).map(async (phoneline) => {
        const phonelineId = stringField(phoneline, "id");
        if (!phonelineId) return { ...phoneline, numbers: [], forwardings: [] };
        const base = `/${encodeId(id)}/phonelines/${encodeId(phonelineId)}`;
        const [lineNumbers, forwardings] = await Promise.all([
          this.client.request<JsonValue>(`${base}/numbers`),
          this.client.request<JsonValue>(`${base}/forwardings`),
        ]);
        return {
          ...phoneline,
          numbers: asItems(lineNumbers).map((number) => ({
            ...number,
            endpointId: phonelineId,
            ...(typeof phoneline.alias === "string" ? { endpointAlias: phoneline.alias } : {}),
          })),
          forwardings: asItems(forwardings),
        };
      }));
      return { userId: id, phonelines, phonelinesAvailable: phonelinesResult.available };
    }));

    const routedNumbers = users.flatMap(({ phonelines }) =>
      phonelines.flatMap((phoneline) => phoneline.numbers));
    const numbers = userId
      ? (routedNumbers.length > 0
        ? routedNumbers
        : asItems(await this.listUserNumbers(userId, { offset: 0, limit: 1000 })))
      : asItems(numbersResponse);
    const uniqueNumbers = [...new Map(numbers.map((number) => [
      stringField(number, "id") ?? stringField(number, "number") ?? JSON.stringify(number),
      number,
    ])).values()];

    return sanitize({ numbers: uniqueNumbers, users });
  }

  public async getCallHistory(query: HistoryQuery): Promise<JsonValue> {
    const response = await this.client.request<JsonValue>("/history", {
      query: {
        connectionIds: query.connectionIds,
        types: query.types ?? ["CALL"],
        directions: query.directions,
        offset: query.offset,
        limit: query.limit,
        from: query.from,
        to: query.to,
        phonenumber: query.phoneNumber,
      },
    });
    const object = response && !Array.isArray(response) && typeof response === "object" ? response : {};
    const items = asItems(response);
    const totalCount = typeof object.totalCount === "number" ? object.totalCount : items.length;
    const nextOffset = query.offset + items.length < totalCount ? query.offset + items.length : null;
    return sanitize({
      items,
      pagination: { offset: query.offset, limit: query.limit, totalCount, nextOffset },
    });
  }

  public async getSettings(userId?: string): Promise<JsonValue> {
    const users = userId
      ? [await this.getUser(userId)]
      : asItems(await this.client.request<JsonValue>("/users"));

    const settings = await Promise.all(users.map(async (userValue) => {
      if (!userValue || Array.isArray(userValue) || typeof userValue !== "object") return null;
      const user = userValue as JsonObject;
      const id = stringField(user, "id");
      if (!id) return null;
      const [devicesResponse, phonelinesResult] = await Promise.all([
        this.client.request<JsonValue>(`/${encodeId(id)}/devices`),
        this.tryListPhonelines(id),
      ]);
      const phonelines = await Promise.all(asItems(phonelinesResult.value).map(async (line) => {
        const lineId = stringField(line, "id");
        if (!lineId) return line;
        return await this.client.request<JsonValue>(`/${encodeId(id)}/phonelines/${encodeId(lineId)}`) ?? line;
      }));
      return {
        user,
        reachability: {
          busyOnBusy: user.busyOnBusy ?? null,
          defaultDevice: user.defaultDevice ?? null,
          devices: asItems(devicesResponse),
        },
        phonelines,
        phonelinesAvailable: phonelinesResult.available,
      };
    }));
    return sanitize({ users: settings.filter((item) => item !== null) });
  }

  public async setNumberRouting(numberId: string, endpointId: string): Promise<MutationResult> {
    const before = await this.findNumber(numberId);
    await this.client.request<JsonValue>(`/numbers/${encodeId(numberId)}`, {
      method: "PUT",
      body: { endpointId },
    });
    const after = await this.findNumber(numberId);
    return { before: sanitize(before), after: sanitize(after) };
  }

  public async setUserNumberRouting(
    userId: string,
    numberId: string,
    endpointId: string,
  ): Promise<MutationResult> {
    const before = await this.findUserNumber(userId, numberId);
    await this.client.request<JsonValue>(`/numbers/${encodeId(numberId)}`, {
      method: "PUT",
      body: { endpointId },
    });
    const after = await this.findUserNumber(userId, numberId);
    return { before: sanitize(before), after: sanitize(after) };
  }

  public async setForwarding(
    userId: string,
    phonelineId: string,
    forwardings: ForwardingRule[],
  ): Promise<MutationResult> {
    const path = `/${encodeId(userId)}/phonelines/${encodeId(phonelineId)}/forwardings`;
    const before = await this.client.request<JsonValue>(path);
    await this.client.request<JsonValue>(path, {
      method: "PUT",
      body: { forwardings },
    });
    const after = await this.client.request<JsonValue>(path);
    return { before: sanitize(before ?? { items: [] }), after: sanitize(after ?? { items: [] }) };
  }

  public async setDnd(deviceId: string, enabled: boolean): Promise<MutationResult> {
    const path = `/devices/${encodeId(deviceId)}`;
    const before = await this.client.request<JsonValue>(path);
    await this.client.request<JsonValue>(path, { method: "PUT", body: { dnd: enabled } });
    const after = await this.client.request<JsonValue>(path);
    return { before: sanitize(before ?? {}), after: sanitize(after ?? {}) };
  }

  public async updateDevice(
    deviceId: string,
    settings: DeviceSettingsInput,
  ): Promise<MutationResult> {
    const path = `/devices/${encodeId(deviceId)}`;
    return this.mutateWithReadback(
      () => this.client.request<JsonValue>(path),
      path,
      {
        ...(settings.dnd === undefined ? {} : { dnd: settings.dnd }),
        ...(settings.emergencyAddressId === undefined
          ? {}
          : { emergencyAddressId: settings.emergencyAddressId }),
      },
    );
  }

  public async deleteDevice(deviceId: string): Promise<MutationResult> {
    const path = `/devices/${encodeId(deviceId)}`;
    const before = await this.client.request<JsonValue>(path);
    const response = await this.client.request<JsonValue>(path, { method: "DELETE" });
    return {
      before: sanitize(before ?? {}),
      after: sanitize({
        deleted: true,
        response: response ?? null,
        note: "sipgate does not provide a deleted-device read-back endpoint.",
      }),
    };
  }

  public setDeviceAlias(deviceId: string, value?: string): Promise<MutationResult> {
    return this.mutateDeviceWithReadback(deviceId, `/devices/${encodeId(deviceId)}/alias`, {
      ...(value === undefined ? {} : { value }),
    });
  }

  public async setDeviceCallerId(deviceId: string, value?: string): Promise<MutationResult> {
    const path = `/devices/${encodeId(deviceId)}/callerid`;
    return this.mutateWithReadback(
      () => this.client.request<JsonValue>(path),
      path,
      { ...(value === undefined ? {} : { value }) },
    );
  }

  public async setDeviceLocalPrefix(
    deviceId: string,
    input: LocalPrefixInput,
  ): Promise<MutationResult> {
    const path = `/devices/${encodeId(deviceId)}/localprefix`;
    return this.mutateWithReadback(
      () => this.client.request<JsonValue>(path),
      path,
      {
        ...(input.active === undefined ? {} : { active: input.active }),
        ...(input.value === undefined ? {} : { value: input.value }),
      },
    );
  }

  public async setDeviceTariffAnnouncement(
    deviceId: string,
    enabled?: boolean,
  ): Promise<MutationResult> {
    const path = `/devices/${encodeId(deviceId)}/tariffannouncement`;
    return this.mutateWithReadback(
      () => this.client.request<JsonValue>(path),
      path,
      { ...(enabled === undefined ? {} : { enabled }) },
    );
  }

  public async setDeviceSingleRowDisplay(
    deviceId: string,
    enabled?: boolean,
  ): Promise<MutationResult> {
    const path = `/devices/${encodeId(deviceId)}/singlerowdisplay`;
    return this.mutateWithReadback(
      () => this.client.request<JsonValue>(path),
      path,
      { ...(enabled === undefined ? {} : { enabled }) },
    );
  }

  public setExternalDeviceTargetNumber(
    deviceId: string,
    number?: string,
  ): Promise<MutationResult> {
    return this.mutateDeviceWithReadback(
      deviceId,
      `/devices/${encodeId(deviceId)}/external/targetnumber`,
      { ...(number === undefined ? {} : { number }) },
    );
  }

  public setExternalDeviceIncomingCallDisplay(
    deviceId: string,
    incomingCallDisplay: "CALLED_NUMBER" | "CALLER_NUMBER",
  ): Promise<MutationResult> {
    return this.mutateDeviceWithReadback(
      deviceId,
      `/devices/${encodeId(deviceId)}/external/incomingcalldisplay`,
      { incomingCallDisplay },
    );
  }

  public async changeDevicePassword(deviceId: string): Promise<MutationResult> {
    const devicePath = `/devices/${encodeId(deviceId)}`;
    const before = await this.client.request<JsonValue>(devicePath);
    const response = sanitize(await this.client.request<JsonValue>(
      `${devicePath}/credentials/password`,
      { method: "POST" },
    ) ?? {});
    return {
      before: sanitize(before ?? {}),
      after: sanitize({
        credentials: response,
        passwordChanged: true,
        note: "sipgate returns the new credential only once; credential values are intentionally redacted.",
      }),
    };
  }

  public createRegisterDevice(userId: string, alias?: string): Promise<MutationResult> {
    return this.createDevice(
      `/${encodeId(userId)}/devices/register`,
      { ...(alias === undefined ? {} : { alias }) },
    );
  }

  public createMobileDevice(userId: string, alias?: string): Promise<MutationResult> {
    return this.createDevice(
      `/${encodeId(userId)}/devices/mobile`,
      { ...(alias === undefined ? {} : { alias }) },
    );
  }

  public createExternalDevice(
    userId: string,
    alias?: string,
    number?: string,
  ): Promise<MutationResult> {
    return this.createDevice(
      `/${encodeId(userId)}/devices/external`,
      {
        ...(alias === undefined ? {} : { alias }),
        ...(number === undefined ? {} : { number }),
      },
    );
  }

  public async createQuickDial(input: QuickDialInput): Promise<MutationResult> {
    const response = await this.client.request<JsonValue>("/numbers/quickdial", {
      method: "POST",
      body: {
        userId: input.userId,
        ...(input.number === undefined ? {} : { number: input.number }),
      },
    });
    return {
      before: null,
      after: sanitize({
        response: response ?? null,
        requestAccepted: true,
        note: "sipgate does not document a quick-dial creation read-back response; use list_user_numbers to inspect the result.",
      }),
    };
  }

  public async updateQuickDial(
    quickDialId: string,
    input: QuickDialInput,
  ): Promise<MutationResult> {
    const before = await this.findNumber(quickDialId);
    await this.client.request<JsonValue>(`/numbers/quickdial/${encodeId(quickDialId)}`, {
      method: "PUT",
      body: {
        userId: input.userId,
        ...(input.number === undefined ? {} : { number: input.number }),
      },
    });
    const after = await this.findNumber(quickDialId);
    return { before: sanitize(before), after: sanitize(after) };
  }

  public async deleteQuickDial(numberId: string): Promise<MutationResult> {
    const before = await this.findNumber(numberId);
    const response = await this.client.request<JsonValue>(
      `/numbers/quickdial/${encodeId(numberId)}`,
      { method: "DELETE" },
    );
    return {
      before: sanitize(before),
      after: sanitize({
        deleted: true,
        response: response ?? null,
        note: "sipgate does not provide a deleted quick-dial read-back endpoint.",
      }),
    };
  }

  public async updateAddress(
    addressId: number,
    input: AddressUpdateInput,
  ): Promise<MutationResult> {
    const path = `/addresses/${addressId}`;
    return this.mutateWithReadback(
      () => this.client.request<JsonValue>(path),
      path,
      {
        city: input.city,
        countrycode: input.countrycode,
        postcode: input.postcode,
        ...(input.address1 === undefined ? {} : { address1: input.address1 }),
        ...(input.address2 === undefined ? {} : { address2: input.address2 }),
        ...(input.number === undefined ? {} : { number: input.number }),
        ...(input.state === undefined ? {} : { state: input.state }),
        ...(input.street === undefined ? {} : { street: input.street }),
      },
    );
  }

  public async sendSms(input: {
    userId: string;
    smsId?: string;
    recipient: string;
    message: string;
    sendAt?: number;
  }): Promise<MutationResult> {
    const extensions = asItems(
      await this.client.request<JsonValue>(`/${encodeId(input.userId)}/sms`),
    );
    const extension = input.smsId
      ? extensions.find((item) => stringField(item, "id") === input.smsId)
      : extensions[0];
    if (!extension) {
      throw new SipgateApiError(
        input.smsId
          ? "The requested SMS extension is not available for this user."
          : "No SMS-capable extension is available for this user.",
        404,
      );
    }
    const smsId = stringField(extension, "id");
    if (!smsId) throw new SipgateApiError("sipgate returned an SMS extension without an ID.");

    const beforeHistory = await this.latestHistory("SMS", input.recipient, [smsId]);
    await this.client.request<JsonValue>("/sessions/sms", {
      method: "POST",
      body: {
        smsId,
        recipient: input.recipient,
        message: input.message,
        ...(input.sendAt === undefined ? {} : { sendAt: input.sendAt }),
      },
    });
    const afterHistory = await this.latestHistory("SMS", input.recipient, [smsId]);
    return {
      before: sanitize({ smsExtension: extension, latestMatchingHistory: beforeHistory }),
      after: sanitize({
        smsExtension: extension,
        latestMatchingHistory: afterHistory,
        requestAccepted: true,
      }),
    };
  }

  public async initiateCall(input: {
    caller: string;
    callee: string;
    callerId?: string;
    deviceId?: string;
  }): Promise<MutationResult> {
    const before = await this.client.request<JsonValue>("/calls");
    const session = await this.client.request<JsonValue>("/sessions/calls", {
      method: "POST",
      body: {
        caller: input.caller,
        callee: input.callee,
        ...(input.callerId === undefined ? {} : { callerId: input.callerId }),
        ...(input.deviceId === undefined ? {} : { deviceId: input.deviceId }),
      },
    });
    const activeCalls = await this.client.request<JsonValue>("/calls");
    return {
      before: sanitize(before ?? { data: [] }),
      after: sanitize({
        activeCalls: activeCalls ?? { data: [] },
        session,
        note: "The active-calls endpoint only includes established calls, so a newly ringing call may not appear immediately.",
      }),
    };
  }

  public async initiateUserCall(input: {
    caller: string;
    callee: string;
    callerId?: string;
    deviceId?: string;
  }): Promise<MutationResult> {
    const session = await this.client.request<JsonValue>("/sessions/calls", {
      method: "POST",
      body: {
        caller: input.caller,
        callee: input.callee,
        ...(input.callerId === undefined ? {} : { callerId: input.callerId }),
        ...(input.deviceId === undefined ? {} : { deviceId: input.deviceId }),
      },
    });
    return {
      before: null,
      after: {
        session: sanitize(session ?? {}),
        requestAccepted: true,
        note: "User scope does not read the account-wide active-calls endpoint before or after Click2Dial.",
      },
    };
  }

  private async findNumber(numberId: string): Promise<JsonObject> {
    const number = (await this.listAllAccountNumbers())
      .find((item) => stringField(item, "id") === numberId);
    if (!number) throw new SipgateApiError("The requested sipgate phone number was not found.", 404);
    return number;
  }

  private async findUserNumber(userId: string, numberId: string): Promise<JsonObject> {
    const response = await this.listUserNumbers(userId, { offset: 0, limit: 1000 });
    const number = asItems(response).find((item) => stringField(item, "id") === numberId);
    if (!number) throw new SipgateApiError("The requested sipgate phone number was not found.", 404);
    return number;
  }

  private async latestHistory(
    type: "SMS" | "CALL",
    phoneNumber: string,
    connectionIds?: string[],
  ): Promise<JsonValue> {
    const response = await this.client.request<JsonValue>("/history", {
      query: {
        connectionIds,
        types: [type],
        directions: ["OUTGOING"],
        phonenumber: phoneNumber,
        offset: 0,
        limit: 1,
      },
    });
    return asItems(response)[0] ?? null;
  }

  private async mutateWithReadback(
    read: () => Promise<JsonValue | undefined>,
    path: string,
    body: JsonObject,
  ): Promise<MutationResult> {
    const before = await read();
    await this.client.request<JsonValue>(path, { method: "PUT", body });
    const after = await read();
    return { before: sanitize(before ?? {}), after: sanitize(after ?? {}) };
  }

  private mutateDeviceWithReadback(
    deviceId: string,
    path: string,
    body: JsonObject,
  ): Promise<MutationResult> {
    return this.mutateWithReadback(
      () => this.client.request<JsonValue>(`/devices/${encodeId(deviceId)}`),
      path,
      body,
    );
  }

  private async createDevice(path: string, body: JsonObject): Promise<MutationResult> {
    const response = await this.client.request<JsonValue>(path, { method: "POST", body });
    return {
      before: null,
      after: sanitize({
        device: response ?? {},
        created: true,
        note: "No device existed before this create operation; the returned device is the initial state.",
      }),
    };
  }
}
