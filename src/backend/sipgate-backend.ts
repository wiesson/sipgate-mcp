import { SipgateApiError, SipgateClient } from "./sipgate-client.js";
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
} from "./telephony-backend.js";

interface ItemsResponse {
  items?: JsonObject[];
  totalCount?: number;
}

const SENSITIVE_KEY = /authorization|credential|password|secret|token|puk\d?|iccid/i;

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

function asCalls(value: JsonValue | undefined): JsonObject[] {
  if (!value || Array.isArray(value) || typeof value !== "object") return [];
  return Array.isArray(value.data)
    ? value.data.filter((item): item is JsonObject =>
      Boolean(item) && !Array.isArray(item) && typeof item === "object")
    : [];
}

function stringField(value: JsonObject, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

function encodeId(id: string): string {
  return encodeURIComponent(id);
}

function phonelineUnavailable(items = false): JsonObject {
  return {
    ...(items ? { items: [] } : {}),
    phonelinesAvailable: false,
    note: "This sipgate account does not provide the phoneline feature.",
  };
}

function phonelineMutationUnavailable(): MutationResult {
  return {
    before: null,
    after: {
      changed: false,
      phonelinesAvailable: false,
      note: "This sipgate account does not provide the phoneline feature; no change was attempted.",
    },
  };
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

  private phonelinePath(userId: string, phonelineId: string, suffix = ""): string {
    return `/${encodeId(userId)}/phonelines/${encodeId(phonelineId)}${suffix}`;
  }

  private async optionalPhonelineRead(path: string, list = false): Promise<JsonValue> {
    const { value, available } = await optional(this.client.request<JsonValue>(path));
    return available ? sanitize(value ?? (list ? { items: [] } : {})) : phonelineUnavailable(list);
  }

  public getPhoneline(userId: string, phonelineId: string): Promise<JsonValue> {
    return this.optionalPhonelineRead(this.phonelinePath(userId, phonelineId));
  }

  public getPhonelineBlockAnonymous(userId: string, phonelineId: string): Promise<JsonValue> {
    return this.optionalPhonelineRead(
      this.phonelinePath(userId, phonelineId, "/blockanonymous"),
    );
  }

  public listPhonelineDevices(userId: string, phonelineId: string): Promise<JsonValue> {
    return this.optionalPhonelineRead(
      this.phonelinePath(userId, phonelineId, "/devices"),
      true,
    );
  }

  public listParallelForwardings(userId: string, phonelineId: string): Promise<JsonValue> {
    return this.optionalPhonelineRead(
      this.phonelinePath(userId, phonelineId, "/parallelforwardings"),
      true,
    );
  }

  public listPhonelineVoicemails(userId: string, phonelineId: string): Promise<JsonValue> {
    return this.optionalPhonelineRead(
      this.phonelinePath(userId, phonelineId, "/voicemails"),
      true,
    );
  }

  public listVoicemailGreetings(
    userId: string,
    phonelineId: string,
    voicemailId: string,
  ): Promise<JsonValue> {
    return this.optionalPhonelineRead(
      this.phonelinePath(
        userId,
        phonelineId,
        `/voicemails/${encodeId(voicemailId)}/greetings`,
      ),
      true,
    );
  }

  public async listVoicemails(): Promise<JsonValue> {
    const response = await this.client.request<JsonValue>("/voicemails");
    return sanitize(response ?? { items: [] });
  }

  public async getVoicemail(voicemailId: string): Promise<JsonValue> {
    const response = await this.client.request<JsonValue>(`/voicemails/${encodeId(voicemailId)}`);
    return sanitize(response ?? {});
  }

  public async listAutorecordingGreetings(): Promise<JsonValue> {
    const { value, available } = await optional(
      this.client.request<JsonValue>("/autorecordings/greetings"),
    );
    return available
      ? sanitize(value ?? {})
      : {
        autorecordingsAvailable: false,
        note: "Automated call recording is not activated for this sipgate account.",
      };
  }

  public async getAutorecordingSettings(extension: string): Promise<JsonValue> {
    const { value, available } = await optional(this.client.request<JsonValue>(
      `/autorecordings/${encodeId(extension)}/settings`,
    ));
    return available
      ? sanitize(value ?? {})
      : {
        autorecordingsAvailable: false,
        note: "Automated call recording is not activated for this extension.",
      };
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

  public async getHistoryEntry(entryId: string): Promise<JsonValue> {
    return sanitize(await this.client.request<JsonValue>(`/history/${encodeId(entryId)}`) ?? {});
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

  public async listCalls(): Promise<JsonValue> {
    const response = await this.client.request<JsonValue>("/calls");
    return sanitize(response ?? { data: [] });
  }

  public async listNotifications(userId: string): Promise<JsonValue> {
    const response = await this.client.request<JsonValue>(
      `/${encodeId(userId)}/notifications`,
    );
    return sanitize(response ?? { call: [], fax: [], sms: [], voicemail: [] });
  }

  public async listFaxlines(userId: string): Promise<JsonValue> {
    const response = await this.client.request<JsonValue>(`/${encodeId(userId)}/faxlines`);
    return sanitize(response ?? { items: [] });
  }

  public async listFaxlineNumbers(userId: string, faxlineId: string): Promise<JsonValue> {
    const response = await this.client.request<JsonValue>(
      `/${encodeId(userId)}/faxlines/${encodeId(faxlineId)}/numbers`,
    );
    return sanitize(response ?? { items: [] });
  }

  public async getFaxlineCallerId(userId: string, faxlineId: string): Promise<JsonValue> {
    const response = await this.client.request<JsonValue>(
      `/${encodeId(userId)}/faxlines/${encodeId(faxlineId)}/callerid`,
    );
    return sanitize(response ?? {});
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

  public async createPhoneline(userId: string): Promise<MutationResult> {
    const { value, available } = await optional(this.client.request<JsonValue>(
      `/${encodeId(userId)}/phonelines`,
      { method: "POST" },
    ));
    if (!available) return phonelineMutationUnavailable();
    return {
      before: null,
      after: sanitize({
        phoneline: value ?? {},
        created: true,
        note: "No phoneline existed before this create operation; the returned phoneline is the initial state.",
      }),
    };
  }

  public updatePhonelineAlias(
    userId: string,
    phonelineId: string,
    alias?: string,
  ): Promise<MutationResult> {
    const path = this.phonelinePath(userId, phonelineId);
    return this.mutateOptionalPhonelineWithReadback(
      path,
      path,
      "PUT",
      { ...(alias === undefined ? {} : { alias }) },
    );
  }

  public async deletePhoneline(userId: string, phonelineId: string): Promise<MutationResult> {
    const path = this.phonelinePath(userId, phonelineId);
    const { value: before, available } = await optional(this.client.request<JsonValue>(path));
    if (!available) return phonelineMutationUnavailable();
    const response = await this.client.request<JsonValue>(path, { method: "DELETE" });
    return {
      before: sanitize(before ?? {}),
      after: sanitize({
        deleted: true,
        response: response ?? null,
        note: "sipgate does not provide a deleted-phoneline read-back endpoint.",
      }),
    };
  }

  public setPhonelineBlockAnonymous(
    userId: string,
    phonelineId: string,
    input: BlockAnonymousInput,
  ): Promise<MutationResult> {
    const path = this.phonelinePath(userId, phonelineId, "/blockanonymous");
    return this.mutateOptionalPhonelineWithReadback(path, path, "PUT", {
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.target === undefined ? {} : { target: input.target }),
    });
  }

  public attachDeviceToPhoneline(
    userId: string,
    phonelineId: string,
    deviceId: string,
  ): Promise<MutationResult> {
    const path = this.phonelinePath(userId, phonelineId, "/devices");
    return this.mutateOptionalPhonelineWithReadback(
      path,
      path,
      "POST",
      { deviceId },
      true,
    );
  }

  public detachDeviceFromPhoneline(
    userId: string,
    phonelineId: string,
    deviceId: string,
  ): Promise<MutationResult> {
    const readPath = this.phonelinePath(userId, phonelineId, "/devices");
    return this.mutateOptionalPhonelineWithReadback(
      readPath,
      `${readPath}/${encodeId(deviceId)}`,
      "DELETE",
      undefined,
      true,
    );
  }

  public createParallelForwarding(
    userId: string,
    phonelineId: string,
    input: ParallelForwardingInput,
  ): Promise<MutationResult> {
    const path = this.phonelinePath(userId, phonelineId, "/parallelforwardings");
    return this.mutateOptionalPhonelineWithReadback(
      path,
      path,
      "POST",
      this.parallelForwardingBody(input),
      true,
    );
  }

  public updateParallelForwarding(
    userId: string,
    phonelineId: string,
    parallelForwardingId: string,
    input: ParallelForwardingInput,
  ): Promise<MutationResult> {
    const readPath = this.phonelinePath(userId, phonelineId, "/parallelforwardings");
    return this.mutateOptionalPhonelineWithReadback(
      readPath,
      `${readPath}/${encodeId(parallelForwardingId)}`,
      "PUT",
      this.parallelForwardingBody(input),
      true,
    );
  }

  public deleteParallelForwarding(
    userId: string,
    phonelineId: string,
    parallelForwardingId: string,
  ): Promise<MutationResult> {
    const readPath = this.phonelinePath(userId, phonelineId, "/parallelforwardings");
    return this.mutateOptionalPhonelineWithReadback(
      readPath,
      `${readPath}/${encodeId(parallelForwardingId)}`,
      "DELETE",
      undefined,
      true,
    );
  }

  public updateVoicemail(
    userId: string,
    phonelineId: string,
    voicemailId: string,
    input: VoicemailSettingsInput,
  ): Promise<MutationResult> {
    const readPath = this.phonelinePath(userId, phonelineId, "/voicemails");
    return this.mutateOptionalPhonelineWithReadback(
      readPath,
      `${readPath}/${encodeId(voicemailId)}`,
      "PUT",
      {
        active: input.active,
        transcription: input.transcription,
        ...(input.timeout === undefined ? {} : { timeout: input.timeout }),
      },
      true,
    );
  }

  public createVoicemailGreeting(
    userId: string,
    phonelineId: string,
    voicemailId: string,
    input: GreetingUploadInput,
  ): Promise<MutationResult> {
    const path = this.phonelinePath(
      userId,
      phonelineId,
      `/voicemails/${encodeId(voicemailId)}/greetings`,
    );
    return this.mutateOptionalPhonelineWithReadback(
      path,
      path,
      "POST",
      this.greetingBody(input),
      true,
    );
  }

  public updateVoicemailGreeting(
    userId: string,
    phonelineId: string,
    voicemailId: string,
    greetingId: string,
    active?: boolean,
  ): Promise<MutationResult> {
    const readPath = this.phonelinePath(
      userId,
      phonelineId,
      `/voicemails/${encodeId(voicemailId)}/greetings`,
    );
    return this.mutateOptionalPhonelineWithReadback(
      readPath,
      `${readPath}/${encodeId(greetingId)}`,
      "PUT",
      { ...(active === undefined ? {} : { active }) },
      true,
    );
  }

  public deleteVoicemailGreeting(
    userId: string,
    phonelineId: string,
    voicemailId: string,
    greetingId: string,
  ): Promise<MutationResult> {
    const readPath = this.phonelinePath(
      userId,
      phonelineId,
      `/voicemails/${encodeId(voicemailId)}/greetings`,
    );
    return this.mutateOptionalPhonelineWithReadback(
      readPath,
      `${readPath}/${encodeId(greetingId)}`,
      "DELETE",
      undefined,
      true,
    );
  }

  public setVoicemailTranscription(
    userId: string,
    phonelineId: string,
    voicemailId: string,
    active?: boolean,
  ): Promise<MutationResult> {
    const readPath = this.phonelinePath(userId, phonelineId, "/voicemails");
    return this.mutateOptionalPhonelineWithReadback(
      readPath,
      `${readPath}/${encodeId(voicemailId)}/transcriptions`,
      "PUT",
      { ...(active === undefined ? {} : { active }) },
      true,
    );
  }

  public async playVoicemail(input: VoicemailPlaybackInput): Promise<MutationResult> {
    const response = await this.client.request<JsonValue>("/sessions/voicemail/play", {
      method: "POST",
      body: {
        ...(input.dataId === undefined ? {} : { datadId: input.dataId }),
        ...(input.deviceId === undefined ? {} : { deviceId: input.deviceId }),
      },
    });
    return this.sessionMutationResult(response, "voicemail playback");
  }

  public async recordVoicemailGreeting(
    input: VoicemailRecordingInput,
  ): Promise<MutationResult> {
    const response = await this.client.request<JsonValue>("/sessions/voicemail/recording", {
      method: "POST",
      body: {
        ...(input.deviceId === undefined ? {} : { deviceId: input.deviceId }),
        ...(input.endpoint === undefined ? {} : { endpoint: input.endpoint }),
        ...(input.targetId === undefined ? {} : { targetId: input.targetId }),
      },
    });
    return this.sessionMutationResult(response, "voicemail-greeting recording");
  }

  public async createAutorecordingGreeting(
    input: GreetingUploadInput,
  ): Promise<MutationResult> {
    const before = await optional(this.client.request<JsonValue>("/autorecordings/greetings"));
    if (!before.available) return this.autorecordingUnavailableMutation();
    await this.client.request<JsonValue>("/autorecordings/greetings", {
      method: "POST",
      body: this.greetingBody(input),
    });
    const after = await optional(this.client.request<JsonValue>("/autorecordings/greetings"));
    return {
      before: sanitize(before.value ?? {}),
      after: after.available
        ? sanitize(after.value ?? {})
        : {
          autorecordingsAvailable: false,
          note: "The greeting was accepted, but automated call recording was unavailable during read-back.",
        },
    };
  }

  public async deleteAutorecordingGreeting(greetingId: string): Promise<MutationResult> {
    const before = await optional(this.client.request<JsonValue>("/autorecordings/greetings"));
    if (!before.available) return this.autorecordingUnavailableMutation();
    const response = await this.client.request<JsonValue>(
      `/autorecordings/greetings/${encodeId(greetingId)}`,
      { method: "DELETE" },
    );
    return {
      before: sanitize(before.value ?? {}),
      after: sanitize({
        deleted: true,
        response: response ?? null,
        note: "sipgate exposes no separate read-back for a deleted automated-recording greeting.",
      }),
    };
  }

  public async setAutorecordingSettings(
    extension: string,
    active?: boolean,
  ): Promise<MutationResult> {
    const path = `/autorecordings/${encodeId(extension)}/settings`;
    const before = await optional(this.client.request<JsonValue>(path));
    if (!before.available) return this.autorecordingUnavailableMutation();
    await this.client.request<JsonValue>(path, {
      method: "PUT",
      body: { ...(active === undefined ? {} : { active }) },
    });
    const after = await optional(this.client.request<JsonValue>(path));
    return {
      before: sanitize(before.value ?? {}),
      after: after.available
        ? sanitize(after.value ?? {})
        : {
          autorecordingsAvailable: false,
          note: "The setting was accepted, but automated call recording was unavailable during read-back.",
        },
    };
  }

  public async createFaxline(userId: string): Promise<MutationResult> {
    const response = await this.client.request<JsonValue>(`/${encodeId(userId)}/faxlines`, {
      method: "POST",
    });
    return {
      before: null,
      after: sanitize({
        faxline: response ?? {},
        created: true,
        note: "No faxline existed before this create operation; the returned faxline is the initial state.",
      }),
    };
  }

  public updateFaxlineAlias(
    userId: string,
    faxlineId: string,
    alias?: string,
  ): Promise<MutationResult> {
    return this.mutateFaxlineWithReadback(userId, faxlineId, "", {
      ...(alias === undefined ? {} : { alias }),
    });
  }

  public async deleteFaxline(userId: string, faxlineId: string): Promise<MutationResult> {
    const before = await this.findFaxline(userId, faxlineId);
    const response = await this.client.request<JsonValue>(
      `/${encodeId(userId)}/faxlines/${encodeId(faxlineId)}`,
      { method: "DELETE" },
    );
    return {
      before: sanitize(before),
      after: sanitize({
        deleted: true,
        response: response ?? null,
        note: "sipgate does not provide a deleted-faxline read-back endpoint.",
      }),
    };
  }

  public setFaxlineCallerId(
    userId: string,
    faxlineId: string,
    value?: string,
  ): Promise<MutationResult> {
    const path = `/${encodeId(userId)}/faxlines/${encodeId(faxlineId)}/callerid`;
    return this.mutateWithReadback(
      () => this.client.request<JsonValue>(path),
      path,
      { ...(value === undefined ? {} : { value }) },
    );
  }

  public setFaxlineTagline(
    userId: string,
    faxlineId: string,
    value?: string,
  ): Promise<MutationResult> {
    return this.mutateFaxlineWithReadback(userId, faxlineId, "/tagline", {
      ...(value === undefined ? {} : { value }),
    });
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

  public createCallEmailNotification(
    input: CallEmailNotificationInput,
  ): Promise<MutationResult> {
    return this.createNotification(
      input.userId,
      "/call/email",
      {
        cause: input.cause,
        direction: input.direction,
        email: input.email,
        endpointId: input.endpointId,
      },
    );
  }

  public createCallSmsNotification(input: CallSmsNotificationInput): Promise<MutationResult> {
    return this.createNotification(
      input.userId,
      "/call/sms",
      {
        cause: input.cause,
        direction: input.direction,
        endpointId: input.endpointId,
        number: input.number,
      },
    );
  }

  public createFaxEmailNotification(input: FaxEmailNotificationInput): Promise<MutationResult> {
    return this.createNotification(
      input.userId,
      "/fax/email",
      {
        direction: input.direction,
        email: input.email,
        faxlineId: input.faxlineId,
      },
    );
  }

  public createFaxSmsNotification(input: FaxSmsNotificationInput): Promise<MutationResult> {
    return this.createNotification(
      input.userId,
      "/fax/sms",
      {
        direction: input.direction,
        faxlineId: input.faxlineId,
        number: input.number,
      },
    );
  }

  public createFaxReportNotification(
    input: FaxReportNotificationInput,
  ): Promise<MutationResult> {
    return this.createNotification(
      input.userId,
      "/fax/report",
      { email: input.email, faxlineId: input.faxlineId },
    );
  }

  public createSmsEmailNotification(input: SmsEmailNotificationInput): Promise<MutationResult> {
    return this.createNotification(
      input.userId,
      "/sms/email",
      { email: input.email, endpointId: input.endpointId },
    );
  }

  public createVoicemailEmailNotification(
    input: VoicemailEmailNotificationInput,
  ): Promise<MutationResult> {
    return this.createNotification(
      input.userId,
      "/voicemail/email",
      { email: input.email, voicemailId: input.voicemailId },
    );
  }

  public createVoicemailSmsNotification(
    input: VoicemailSmsNotificationInput,
  ): Promise<MutationResult> {
    return this.createNotification(
      input.userId,
      "/voicemail/sms",
      { number: input.number, voicemailId: input.voicemailId },
    );
  }

  public async deleteNotification(
    userId: string,
    notificationId: string,
  ): Promise<MutationResult> {
    const before = await this.listNotifications(userId);
    await this.client.request<JsonValue>(
      `/${encodeId(userId)}/notifications/${encodeId(notificationId)}`,
      { method: "DELETE" },
    );
    const after = await this.listNotifications(userId);
    return { before, after };
  }

  public async hangupCall(callId: string): Promise<MutationResult> {
    return this.mutateCallWithReadback(callId, `/calls/${encodeId(callId)}`, "DELETE");
  }

  public setCallHold(callId: string, value: boolean): Promise<MutationResult> {
    return this.mutateCallWithReadback(
      callId,
      `/calls/${encodeId(callId)}/hold`,
      "PUT",
      { value },
    );
  }

  public setCallMuted(callId: string, value: boolean): Promise<MutationResult> {
    return this.mutateCallWithReadback(
      callId,
      `/calls/${encodeId(callId)}/muted`,
      "PUT",
      { value },
    );
  }

  public setCallRecording(
    callId: string,
    value: boolean,
    announcement?: boolean,
  ): Promise<MutationResult> {
    return this.mutateCallWithReadback(
      callId,
      `/calls/${encodeId(callId)}/recording`,
      "PUT",
      { value, ...(announcement === undefined ? {} : { announcement }) },
    );
  }

  public transferCall(callId: string, input: CallTransferInput): Promise<MutationResult> {
    return this.mutateCallWithReadback(
      callId,
      `/calls/${encodeId(callId)}/transfer`,
      "POST",
      {
        attended: input.attended,
        phoneNumber: input.phoneNumber,
        ...(input.callerId === undefined ? {} : { callerId: input.callerId }),
      },
    );
  }

  public sendCallDtmf(callId: string, sequence: string): Promise<MutationResult> {
    return this.mutateCallWithReadback(
      callId,
      `/calls/${encodeId(callId)}/dtmf`,
      "POST",
      { sequence },
    );
  }

  public startCallAnnouncement(callId: string, url: string): Promise<MutationResult> {
    return this.mutateCallWithReadback(
      callId,
      `/calls/${encodeId(callId)}/announcements`,
      "POST",
      { url },
    );
  }

  public async sendFax(input: SendFaxInput): Promise<MutationResult> {
    const response = await this.client.request<JsonValue>("/sessions/fax", {
      method: "POST",
      body: {
        base64Content: input.base64Content,
        faxlineId: input.faxlineId,
        filename: input.filename,
        recipient: input.recipient,
      },
    });
    return {
      before: null,
      after: sanitize({
        session: response ?? null,
        requestAccepted: true,
        note: "sipgate does not expose a synchronous fax-session read-back; sending a fax may incur charges.",
      }),
    };
  }

  public async resendFax(input: ResendFaxInput): Promise<MutationResult> {
    const response = await this.client.request<JsonValue>("/sessions/fax/resend", {
      method: "POST",
      body: {
        faxId: input.faxId,
        ...(input.faxlineId === undefined ? {} : { faxlineId: input.faxlineId }),
      },
    });
    return {
      before: null,
      after: sanitize({
        response: response ?? null,
        requestAccepted: true,
        note: "sipgate does not document a fax-resend read-back response; resending a fax may incur charges.",
      }),
    };
  }

  private async createNotification(
    userId: string,
    suffix: string,
    body: JsonObject,
  ): Promise<MutationResult> {
    const before = await this.listNotifications(userId);
    await this.client.request<JsonValue>(
      `/${encodeId(userId)}/notifications${suffix}`,
      { method: "POST", body },
    );
    const after = await this.listNotifications(userId);
    return { before, after };
  }

  private async findActiveCall(callId: string): Promise<JsonObject | undefined> {
    const response = await this.client.request<JsonValue>("/calls");
    return asCalls(response).find((call) => stringField(call, "callId") === callId);
  }

  private async mutateCallWithReadback(
    callId: string,
    path: string,
    method: "POST" | "PUT" | "DELETE",
    body?: JsonObject,
  ): Promise<MutationResult> {
    const before = await this.findActiveCall(callId);
    if (!before) throw new SipgateApiError("The requested active sipgate call was not found.", 404);
    await this.client.request<JsonValue>(path, {
      method,
      ...(body === undefined ? {} : { body }),
    });
    const after = await this.findActiveCall(callId);
    return {
      before: sanitize(before),
      after: after
        ? sanitize(after)
        : {
          call: null,
          active: false,
          note: "The call no longer appears in sipgate's established-calls list after the operation.",
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

  private async mutateOptionalPhonelineWithReadback(
    readPath: string,
    writePath: string,
    method: "POST" | "PUT" | "DELETE",
    body?: JsonObject,
    list = false,
  ): Promise<MutationResult> {
    const before = await optional(this.client.request<JsonValue>(readPath));
    if (!before.available) return phonelineMutationUnavailable();
    await this.client.request<JsonValue>(writePath, {
      method,
      ...(body === undefined ? {} : { body }),
    });
    const after = await optional(this.client.request<JsonValue>(readPath));
    return {
      before: sanitize(before.value ?? (list ? { items: [] } : {})),
      after: after.available
        ? sanitize(after.value ?? (list ? { items: [] } : {}))
        : phonelineUnavailable(list),
    };
  }

  private parallelForwardingBody(input: ParallelForwardingInput): JsonObject {
    return {
      ...(input.active === undefined ? {} : { active: input.active }),
      ...(input.alias === undefined ? {} : { alias: input.alias }),
      ...(input.destination === undefined ? {} : { destination: input.destination }),
    };
  }

  private greetingBody(input: GreetingUploadInput): JsonObject {
    return {
      ...(input.base64Content === undefined ? {} : { base64Content: input.base64Content }),
      ...(input.filename === undefined ? {} : { filename: input.filename }),
    };
  }

  private sessionMutationResult(response: JsonValue | undefined, action: string): MutationResult {
    return {
      before: null,
      after: sanitize({
        session: response ?? null,
        requestAccepted: true,
        note: `sipgate exposes no synchronous ${action} read-back. The call may incur charges; the caller is responsible for consent where recording law requires it.`,
      }),
    };
  }

  private autorecordingUnavailableMutation(): MutationResult {
    return {
      before: null,
      after: {
        changed: false,
        autorecordingsAvailable: false,
        note: "Automated call recording is not activated for this sipgate account; no change was attempted.",
      },
    };
  }

  private async findFaxline(userId: string, faxlineId: string): Promise<JsonObject> {
    const response = await this.listFaxlines(userId);
    const faxline = asItems(response).find((item) => stringField(item, "id") === faxlineId);
    if (!faxline) throw new SipgateApiError("The requested sipgate faxline was not found.", 404);
    return faxline;
  }

  private async mutateFaxlineWithReadback(
    userId: string,
    faxlineId: string,
    suffix: string,
    body: JsonObject,
  ): Promise<MutationResult> {
    const before = await this.findFaxline(userId, faxlineId);
    await this.client.request<JsonValue>(
      `/${encodeId(userId)}/faxlines/${encodeId(faxlineId)}${suffix}`,
      { method: "PUT", body },
    );
    const after = await this.findFaxline(userId, faxlineId);
    return { before: sanitize(before), after: sanitize(after) };
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
