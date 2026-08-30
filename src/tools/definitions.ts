import { z } from "zod";
import type { AccessScope, JsonValue, TelephonyBackend } from "../backend/telephony-backend.js";

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodType<Record<string, unknown>>;
  annotations: ToolAnnotations;
  execute(input: unknown): Promise<JsonValue>;
}

const readAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const writeAnnotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

const actionAnnotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

const id = z.string().trim().min(1).max(128);
const int32Id = z.int().min(-2_147_483_648).max(2_147_483_647);
const swaggerString = z.string();
const e164 = z.string().regex(/^\+[1-9]\d{6,14}$/, "Use an E.164 phone number such as +4915799912345");
const isoDateTime = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Use an ISO 8601 date-time");

function define<T extends z.ZodType<Record<string, unknown>>>(options: {
  name: string;
  description: string;
  schema: T;
  annotations: ToolAnnotations;
  execute: (input: z.infer<T>) => Promise<JsonValue>;
}): ToolDefinition {
  return {
    name: options.name,
    description: options.description,
    inputSchema: options.schema,
    annotations: options.annotations,
    execute: async (input) => options.execute(options.schema.parse(input)),
  };
}

export function createToolDefinitions(
  backend: TelephonyBackend,
  readonly = false,
  accessScope: AccessScope = "user",
): ToolDefinition[] {
  const userScoped = accessScope === "user";
  const changeWarning = userScoped
    ? "CHANGES THE AUTHENTICATED USER'S SIPGATE ACCOUNT AND MAY INCUR CHARGES:"
    : "CHANGES THE SIPGATE ACCOUNT AND MAY INCUR CHARGES:";
  const readTools = [
    define({
      name: "account_info",
      description: userScoped
        ? "Return the authenticated sipgate user's identity and active MCP access scope."
        : "Return sipgate account data, the authenticated administrator's identity, and active MCP access scope.",
      schema: z.object({}),
      annotations: readAnnotations,
      execute: async () => backend.getAccountInfo(),
    }),
    define({
      name: "list_users",
      description: userScoped
        ? "Return only the authenticated sipgate user, including the ID used by other tools."
        : "List all users in the sipgate account, including IDs used by other tools.",
      schema: z.object({}),
      annotations: readAnnotations,
      execute: async () => backend.listUsers(),
    }),
    define({
      name: "list_numbers",
      description: userScoped
        ? "List phone numbers assigned to the authenticated user's phonelines and their endpoint assignments."
        : "List all sipgate phone numbers and their current endpoint assignments.",
      schema: z.object({
        offset: z.int().min(0).default(0).describe("Zero-based pagination offset"),
        limit: z.int().min(1).max(1000).default(1000).describe("Maximum number of phone numbers"),
      }),
      annotations: readAnnotations,
      execute: async ({ offset, limit }) => backend.listNumbers({ offset, limit }),
    }),
    define({
      name: "list_devices",
      description: userScoped
        ? "List the authenticated user's phones and devices with active routing, DND, and online/register status."
        : "List phones and devices with owner, active routing, DND, and online/register status. Without user_id, all users are queried.",
      schema: z.object({
        user_id: id.optional().describe(userScoped
          ? "Optional authenticated sipgate user ID; another user's ID is rejected"
          : "Limit results to one sipgate user ID, for example w0"),
        types: z.array(z.enum(["all", "app", "register", "mobile", "external"])).min(1).optional()
          .describe("Optional sipgate device-type filters"),
      }),
      annotations: readAnnotations,
      execute: async ({ user_id, types }) => backend.listDevices(user_id, types),
    }),
    define({
      name: "get_device",
      description: "Get one sipgate device and its current settings after verifying user-scope ownership.",
      schema: z.object({ device_id: id.describe("Device ID returned by list_devices") }),
      annotations: readAnnotations,
      execute: async ({ device_id }) => backend.getDevice(device_id),
    }),
    define({
      name: "get_device_caller_id",
      description: "Get the outgoing caller ID configured for one owned sipgate device.",
      schema: z.object({ device_id: id.describe("Device ID returned by list_devices") }),
      annotations: readAnnotations,
      execute: async ({ device_id }) => backend.getDeviceCallerId(device_id),
    }),
    define({
      name: "get_device_local_prefix",
      description: "Get the automatic local-area-code prefix setting for one owned sipgate device.",
      schema: z.object({ device_id: id.describe("Device ID returned by list_devices") }),
      annotations: readAnnotations,
      execute: async ({ device_id }) => backend.getDeviceLocalPrefix(device_id),
    }),
    define({
      name: "get_device_tariff_announcement",
      description: "Get the tariff-announcement setting for one owned sipgate device.",
      schema: z.object({ device_id: id.describe("Device ID returned by list_devices") }),
      annotations: readAnnotations,
      execute: async ({ device_id }) => backend.getDeviceTariffAnnouncement(device_id),
    }),
    define({
      name: "get_device_single_row_display",
      description: "Get the single-row display setting for one owned sipgate device.",
      schema: z.object({ device_id: id.describe("Device ID returned by list_devices") }),
      annotations: readAnnotations,
      execute: async ({ device_id }) => backend.getDeviceSingleRowDisplay(device_id),
    }),
    define({
      name: "get_device_contingents",
      description: "List the booked and remaining contingents for one owned sipgate device.",
      schema: z.object({
        user_id: id.describe(userScoped
          ? "Authenticated sipgate user ID; another user's ID is rejected"
          : "Owner user ID, for example w0"),
        device_id: id.describe("Device ID returned by list_devices"),
      }),
      annotations: readAnnotations,
      execute: async ({ user_id, device_id }) => backend.getDeviceContingents(user_id, device_id),
    }),
    define({
      name: "list_user_numbers",
      description: "List phone numbers from sipgate's documented user-specific numbers endpoint without using phonelines.",
      schema: z.object({
        user_id: id.describe(userScoped
          ? "Authenticated sipgate user ID; another user's ID is rejected"
          : "sipgate user ID, for example w0"),
      }),
      annotations: readAnnotations,
      execute: async ({ user_id }) => backend.getUserNumbers(user_id),
    }),
    define({
      name: "validate_quick_dial",
      description: "Check whether a quick-dial number is already taken in the sipgate account.",
      schema: z.object({ quick_dial_number: swaggerString.describe("Quick-dial number, for example 42") }),
      annotations: readAnnotations,
      execute: async ({ quick_dial_number }) => backend.validateQuickDialNumber(quick_dial_number),
    }),
    define({
      name: "list_addresses",
      description: userScoped
        ? "List only emergency addresses associated with the authenticated user's devices or phone numbers."
        : "List all sipgate account addresses.",
      schema: z.object({}),
      annotations: readAnnotations,
      execute: async () => backend.listAddresses(),
    }),
    define({
      name: "get_address",
      description: "Get one emergency address after verifying user-scope ownership.",
      schema: z.object({ address_id: int32Id.describe("Integer address ID returned by list_addresses") }),
      annotations: readAnnotations,
      execute: async ({ address_id }) => backend.getAddress(address_id),
    }),
    define({
      name: "list_address_numbers",
      description: "List phone numbers associated with one emergency address after verifying user-scope ownership.",
      schema: z.object({ address_id: int32Id.describe("Integer address ID returned by list_addresses") }),
      annotations: readAnnotations,
      execute: async ({ address_id }) => backend.listAddressNumbers(address_id),
    }),
    define({
      name: "get_routing",
      description: userScoped
        ? "Return the authenticated user's number-to-endpoint routing, phonelines, assigned numbers, and active or timeout forwardings."
        : "Return account-wide number-to-endpoint routing plus each user's phonelines, assigned numbers, and active or timeout forwardings.",
      schema: z.object({
        user_id: id.optional().describe(userScoped
          ? "Optional authenticated sipgate user ID; another user's ID is rejected"
          : "Limit phoneline forwarding details to one sipgate user ID"),
      }),
      annotations: readAnnotations,
      execute: async ({ user_id }) => backend.getRouting(user_id),
    }),
    define({
      name: "call_history",
      description: userScoped
        ? "List the authenticated user's paginated call history with optional direction, time-range, number, and owned-connection filters."
        : "List account-wide paginated call history with optional direction, time-range, number, and connection filters.",
      schema: z.object({
        directions: z.array(z.enum(["INCOMING", "OUTGOING", "MISSED_INCOMING", "MISSED_OUTGOING"])).min(1).optional(),
        from: isoDateTime.optional().describe("Inclusive ISO 8601 start date-time"),
        to: isoDateTime.optional().describe("Inclusive ISO 8601 end date-time"),
        phone_number: e164.optional().describe("Only calls to or from this phone number"),
        connection_ids: z.array(id).min(1).optional().describe("Optional sipgate extension IDs"),
        offset: z.int().min(0).default(0),
        limit: z.int().min(1).max(1000).default(100),
      }).refine((value) => !value.from || !value.to || Date.parse(value.from) <= Date.parse(value.to), {
        message: "from must be before or equal to to",
        path: ["from"],
      }),
      annotations: readAnnotations,
      execute: async ({ directions, from, to, phone_number, connection_ids, offset, limit }) =>
        backend.getCallHistory({
          offset,
          limit,
          types: ["CALL"],
          ...(directions === undefined ? {} : { directions }),
          ...(from === undefined ? {} : { from }),
          ...(to === undefined ? {} : { to }),
          ...(phone_number === undefined ? {} : { phoneNumber: phone_number }),
          ...(connection_ids === undefined ? {} : { connectionIds: connection_ids }),
        }),
    }),
    define({
      name: "get_settings",
      description: userScoped
        ? "Return the authenticated user's reachability settings, device availability/DND state, and phoneline voicemail activation and timeout settings."
        : "Return relevant account-user reachability settings, device availability/DND state, and phoneline voicemail activation and timeout settings.",
      schema: z.object({
        user_id: id.optional().describe(userScoped
          ? "Optional authenticated sipgate user ID; another user's ID is rejected"
          : "Limit settings to one sipgate user ID"),
      }),
      annotations: readAnnotations,
      execute: async ({ user_id }) => backend.getSettings(user_id),
    }),
  ];

  if (readonly) return readTools;

  const writeTools = [
    define({
      name: "set_number_routing",
      description: `${changeWarning} route a phone number to a sipgate endpoint ID. Reads and returns before/after state.`,
      schema: z.object({
        number_id: id.describe("Phone-number ID returned by list_numbers"),
        endpoint_id: id.describe("Destination endpoint ID accepted by sipgate, for example p0"),
      }),
      annotations: writeAnnotations,
      execute: async ({ number_id, endpoint_id }) => backend.setNumberRouting(number_id, endpoint_id),
    }),
    define({
      name: "set_forwarding",
      description: `${changeWarning} replace all forwardings for a phoneline, including timeout routing. Pass [] to delete all forwardings. Returns before/after state.`,
      schema: z.object({
        user_id: id.describe(userScoped
          ? "Authenticated sipgate user ID; another user's ID is rejected"
          : "Owner user ID, for example w0"),
        phoneline_id: id.describe("Phoneline ID, for example p0"),
        forwardings: z.array(z.object({
          active: z.boolean().default(true),
          destination: e164,
          timeout: z.int().min(0).describe("Seconds before forwarding; use 0 for immediate forwarding"),
        })).describe("Complete replacement list; [] removes every forwarding"),
      }),
      annotations: writeAnnotations,
      execute: async ({ user_id, phoneline_id, forwardings }) =>
        backend.setForwarding(user_id, phoneline_id, forwardings),
    }),
    define({
      name: "set_dnd",
      description: `${changeWarning} enable or disable Do Not Disturb for one device. Returns before/after state.`,
      schema: z.object({
        device_id: id.describe("Device ID returned by list_devices"),
        enabled: z.boolean(),
      }),
      annotations: writeAnnotations,
      execute: async ({ device_id, enabled }) => backend.setDnd(device_id, enabled),
    }),
    define({
      name: "update_device",
      description: `${changeWarning} update DND and/or the emergency address for an owned device. Returns before/after state.`,
      schema: z.object({
        device_id: id.describe("Device ID returned by list_devices"),
        dnd: z.boolean().optional(),
        emergency_address_id: int32Id.optional().describe("Address ID returned by list_addresses"),
      }),
      annotations: writeAnnotations,
      execute: async ({ device_id, dnd, emergency_address_id }) => backend.updateDevice(device_id, {
        ...(dnd === undefined ? {} : { dnd }),
        ...(emergency_address_id === undefined ? {} : { emergencyAddressId: emergency_address_id }),
      }),
    }),
    define({
      name: "delete_device",
      description: `${changeWarning} permanently delete an owned device. Returns the previous device and an explicit deletion marker.`,
      schema: z.object({ device_id: id.describe("Device ID returned by list_devices") }),
      annotations: writeAnnotations,
      execute: async ({ device_id }) => backend.deleteDevice(device_id),
    }),
    define({
      name: "set_device_alias",
      description: `${changeWarning} update the alias of an owned device. Returns before/after device state.`,
      schema: z.object({
        device_id: id.describe("Device ID returned by list_devices"),
        value: swaggerString.optional().describe("New device alias"),
      }),
      annotations: writeAnnotations,
      execute: async ({ device_id, value }) => backend.setDeviceAlias(device_id, value),
    }),
    define({
      name: "set_device_caller_id",
      description: `${changeWarning} update the caller ID of an owned device to one of the authenticated user's owned numbers. Returns before/after state.`,
      schema: z.object({
        device_id: id.describe("Device ID returned by list_devices"),
        value: swaggerString.optional().describe("Caller ID value accepted by sipgate"),
      }),
      annotations: writeAnnotations,
      execute: async ({ device_id, value }) => backend.setDeviceCallerId(device_id, value),
    }),
    define({
      name: "set_device_local_prefix",
      description: `${changeWarning} update automatic local-area-code handling for an owned device. Returns before/after state.`,
      schema: z.object({
        device_id: id.describe("Device ID returned by list_devices"),
        active: z.boolean().optional(),
        value: swaggerString.optional().describe("Local prefix, for example 030"),
      }),
      annotations: writeAnnotations,
      execute: async ({ device_id, active, value }) => backend.setDeviceLocalPrefix(device_id, {
        ...(active === undefined ? {} : { active }),
        ...(value === undefined ? {} : { value }),
      }),
    }),
    define({
      name: "set_device_tariff_announcement",
      description: `${changeWarning} update the tariff-announcement setting for an owned device. Returns before/after state.`,
      schema: z.object({
        device_id: id.describe("Device ID returned by list_devices"),
        enabled: z.boolean().optional(),
      }),
      annotations: writeAnnotations,
      execute: async ({ device_id, enabled }) => backend.setDeviceTariffAnnouncement(device_id, enabled),
    }),
    define({
      name: "set_device_single_row_display",
      description: `${changeWarning} update the single-row display setting for an owned device. Returns before/after state.`,
      schema: z.object({
        device_id: id.describe("Device ID returned by list_devices"),
        enabled: z.boolean().optional(),
      }),
      annotations: writeAnnotations,
      execute: async ({ device_id, enabled }) => backend.setDeviceSingleRowDisplay(device_id, enabled),
    }),
    define({
      name: "set_external_device_target_number",
      description: `${changeWarning} update the target phone number of an owned external device. Returns before/after device state.`,
      schema: z.object({
        device_id: id.describe("External device ID returned by list_devices"),
        number: swaggerString.optional().describe("External target phone number"),
      }),
      annotations: writeAnnotations,
      execute: async ({ device_id, number }) => backend.setExternalDeviceTargetNumber(device_id, number),
    }),
    define({
      name: "set_external_device_incoming_call_display",
      description: `${changeWarning} choose whether an owned external device sees the called or caller number. Returns before/after device state.`,
      schema: z.object({
        device_id: id.describe("External device ID returned by list_devices"),
        incoming_call_display: z.enum(["CALLED_NUMBER", "CALLER_NUMBER"]),
      }),
      annotations: writeAnnotations,
      execute: async ({ device_id, incoming_call_display }) =>
        backend.setExternalDeviceIncomingCallDisplay(device_id, incoming_call_display),
    }),
    define({
      name: "change_device_password",
      description: `${changeWarning} rotate an owned register device's SIP password. The returned credential is always redacted.`,
      schema: z.object({ device_id: id.describe("Register device ID returned by list_devices") }),
      annotations: actionAnnotations,
      execute: async ({ device_id }) => backend.changeDevicePassword(device_id),
    }),
    define({
      name: "create_register_device",
      description: `${changeWarning} create a SIP register device; device creation may affect billing. Returns the sanitized initial device state.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        alias: swaggerString.optional(),
      }),
      annotations: actionAnnotations,
      execute: async ({ user_id, alias }) => backend.createRegisterDevice(user_id, alias),
    }),
    define({
      name: "create_mobile_device",
      description: `${changeWarning} create a mobile device; device or SIM provisioning may affect billing. Returns the sanitized initial device state.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        alias: swaggerString.optional(),
      }),
      annotations: actionAnnotations,
      execute: async ({ user_id, alias }) => backend.createMobileDevice(user_id, alias),
    }),
    define({
      name: "create_external_device",
      description: `${changeWarning} create an external device; device provisioning or calls may affect billing. Returns the sanitized initial device state.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        alias: swaggerString.optional(),
        number: swaggerString.optional().describe("External target phone number"),
      }),
      annotations: actionAnnotations,
      execute: async ({ user_id, alias, number }) => backend.createExternalDevice(user_id, alias, number),
    }),
    define({
      name: "create_quick_dial",
      description: `${changeWarning} create a quick-dial number for a sipgate user. The API has no documented read-back response.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        number: swaggerString.optional().describe("Quick-dial number"),
      }),
      annotations: actionAnnotations,
      execute: async ({ user_id, number }) => backend.createQuickDial({
        userId: user_id,
        ...(number === undefined ? {} : { number }),
      }),
    }),
    define({
      name: "update_quick_dial",
      description: `${changeWarning} update an owned quick-dial number and its assigned user. Returns before/after state.`,
      schema: z.object({
        quick_dial_id: id.describe("Quick-dial ID returned by list_user_numbers or list_numbers"),
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        number: swaggerString.optional().describe("Quick-dial number"),
      }),
      annotations: writeAnnotations,
      execute: async ({ quick_dial_id, user_id, number }) => backend.updateQuickDial(quick_dial_id, {
        userId: user_id,
        ...(number === undefined ? {} : { number }),
      }),
    }),
    define({
      name: "delete_quick_dial",
      description: `${changeWarning} permanently delete an owned quick-dial number. Returns its previous state and a deletion marker.`,
      schema: z.object({ number_id: id.describe("Quick-dial number ID") }),
      annotations: writeAnnotations,
      execute: async ({ number_id }) => backend.deleteQuickDial(number_id),
    }),
    define({
      name: "update_address",
      description: `${changeWarning} update an owned emergency address. Depending on the country, this may deactivate associated phone numbers. Returns before/after state.`,
      schema: z.object({
        address_id: int32Id.describe("Integer address ID returned by list_addresses"),
        city: swaggerString,
        countrycode: swaggerString,
        postcode: swaggerString,
        address1: swaggerString.optional(),
        address2: swaggerString.optional(),
        number: swaggerString.optional().describe("Street/house number, as named by sipgate's schema"),
        state: swaggerString.optional(),
        street: swaggerString.optional(),
      }),
      annotations: writeAnnotations,
      execute: async ({
        address_id,
        city,
        countrycode,
        postcode,
        address1,
        address2,
        number,
        state,
        street,
      }) => backend.updateAddress(address_id, {
        city,
        countrycode,
        postcode,
        ...(address1 === undefined ? {} : { address1 }),
        ...(address2 === undefined ? {} : { address2 }),
        ...(number === undefined ? {} : { number }),
        ...(state === undefined ? {} : { state }),
        ...(street === undefined ? {} : { street }),
      }),
    }),
    define({
      name: "send_sms",
      description: `${changeWarning} send an SMS after verifying an SMS-capable extension. Returns a before/after history snapshot; history can update asynchronously.`,
      schema: z.object({
        user_id: id.describe(userScoped
          ? "Authenticated sipgate user ID; another user's ID is rejected"
          : "Owner of the SMS extension"),
        sms_id: id.optional().describe("SMS extension ID; the first available extension is used when omitted"),
        recipient: e164,
        message: z.string().min(1),
        send_at: z.int().min(0).optional().describe("Optional Unix timestamp in seconds"),
      }),
      annotations: actionAnnotations,
      execute: async ({ user_id, sms_id, recipient, message, send_at }) => backend.sendSms({
        userId: user_id,
        recipient,
        message,
        ...(sms_id === undefined ? {} : { smsId: sms_id }),
        ...(send_at === undefined ? {} : { sendAt: send_at }),
      }),
    }),
    define({
      name: "initiate_call",
      description: `${changeWarning} start a Click2Dial call from a verified device or phone number. Returns before/after call state and the new session.`,
      schema: z.object({
        caller: id.describe("sipgate device ID or caller phone number"),
        callee: e164,
        caller_id: e164.optional().describe("Optional number displayed to the callee"),
        device_id: id.optional().describe("Required by sipgate when caller is a phone number instead of a device ID"),
      }),
      annotations: actionAnnotations,
      execute: async ({ caller, callee, caller_id, device_id }) => backend.initiateCall({
        caller,
        callee,
        ...(caller_id === undefined ? {} : { callerId: caller_id }),
        ...(device_id === undefined ? {} : { deviceId: device_id }),
      }),
    }),
  ];

  return [...readTools, ...writeTools];
}
