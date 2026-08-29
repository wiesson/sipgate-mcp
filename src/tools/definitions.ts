import { z } from "zod";
import type { JsonValue, TelephonyBackend } from "../backend/telephony-backend.js";

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
): ToolDefinition[] {
  const readTools = [
    define({
      name: "account_info",
      description: "Return sipgate account data and the authenticated user's identity.",
      schema: z.object({}),
      annotations: readAnnotations,
      execute: async () => backend.getAccountInfo(),
    }),
    define({
      name: "list_users",
      description: "List all users in the sipgate account, including IDs used by other tools.",
      schema: z.object({}),
      annotations: readAnnotations,
      execute: async () => backend.listUsers(),
    }),
    define({
      name: "list_numbers",
      description: "List sipgate phone numbers and their current endpoint assignments.",
      schema: z.object({
        offset: z.int().min(0).default(0).describe("Zero-based pagination offset"),
        limit: z.int().min(1).max(1000).default(1000).describe("Maximum number of phone numbers"),
      }),
      annotations: readAnnotations,
      execute: async ({ offset, limit }) => backend.listNumbers({ offset, limit }),
    }),
    define({
      name: "list_devices",
      description: "List phones and devices with owner, active routing, DND, and online/register status. Without user_id, all users are queried.",
      schema: z.object({
        user_id: id.optional().describe("Limit results to one sipgate user ID, for example w0"),
        types: z.array(z.enum(["all", "app", "register", "mobile", "external"])).min(1).optional()
          .describe("Optional sipgate device-type filters"),
      }),
      annotations: readAnnotations,
      execute: async ({ user_id, types }) => backend.listDevices(user_id, types),
    }),
    define({
      name: "get_routing",
      description: "Return number-to-endpoint routing plus each user's phonelines, assigned numbers, and active or timeout forwardings.",
      schema: z.object({
        user_id: id.optional().describe("Limit phoneline forwarding details to one sipgate user ID"),
      }),
      annotations: readAnnotations,
      execute: async ({ user_id }) => backend.getRouting(user_id),
    }),
    define({
      name: "call_history",
      description: "List paginated call history with optional direction, time-range, number, and connection filters.",
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
      description: "Return relevant user reachability settings, device availability/DND state, and phoneline voicemail activation and timeout settings.",
      schema: z.object({
        user_id: id.optional().describe("Limit settings to one sipgate user ID"),
      }),
      annotations: readAnnotations,
      execute: async ({ user_id }) => backend.getSettings(user_id),
    }),
  ];

  if (readonly) return readTools;

  const writeTools = [
    define({
      name: "set_number_routing",
      description: "CHANGES THE SIPGATE ACCOUNT: route a phone number to a sipgate endpoint ID (for example a phoneline). Reads and returns the number's before/after state.",
      schema: z.object({
        number_id: id.describe("Phone-number ID returned by list_numbers"),
        endpoint_id: id.describe("Destination endpoint ID accepted by sipgate, for example p0"),
      }),
      annotations: writeAnnotations,
      execute: async ({ number_id, endpoint_id }) => backend.setNumberRouting(number_id, endpoint_id),
    }),
    define({
      name: "set_forwarding",
      description: "CHANGES THE SIPGATE ACCOUNT: replace all forwardings for a phoneline, including timeout routing. Pass an empty forwardings array to delete all forwardings. Reads and returns before/after state.",
      schema: z.object({
        user_id: id.describe("Owner user ID, for example w0"),
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
      description: "CHANGES THE SIPGATE ACCOUNT: enable or disable Do Not Disturb for one device. Reads and returns the device's before/after state.",
      schema: z.object({
        device_id: id.describe("Device ID returned by list_devices"),
        enabled: z.boolean(),
      }),
      annotations: writeAnnotations,
      execute: async ({ device_id, enabled }) => backend.setDnd(device_id, enabled),
    }),
    define({
      name: "send_sms",
      description: "CHANGES THE SIPGATE ACCOUNT AND MAY INCUR CHARGES: send an SMS after verifying an SMS-capable extension. Reads and returns the relevant before/after history snapshot; history can update asynchronously.",
      schema: z.object({
        user_id: id.describe("Owner of the SMS extension"),
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
      description: "CHANGES THE SIPGATE ACCOUNT AND MAY INCUR CHARGES: start a Click2Dial call. Reads established calls before and after and returns the new session; ringing calls may not appear immediately.",
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
