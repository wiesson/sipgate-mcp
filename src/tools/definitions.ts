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
/** sipgate documents these as plain strings and accepts national formats. */
const dialString = z.string().trim().min(3).regex(
  /^[+0-9][0-9 ()\/.-]*$/,
  "Use a phone number, for example +4915799912345 or 0211 1234567",
);
const isoDateTime = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Use an ISO 8601 date-time");
const contactScope = z.enum(["PRIVATE", "SHARED", "INTERNAL"]);
const contactWriteScope = z.enum(["PRIVATE", "SHARED", "INTERNAL", "PRIVATE,SHARED"]);
const contactAddress = z.object({
  country: swaggerString.optional(),
  extendedAddress: swaggerString.optional(),
  locality: swaggerString.optional(),
  poBox: swaggerString.optional(),
  postalCode: swaggerString.optional(),
  region: swaggerString.optional(),
  streetAddress: swaggerString.optional(),
  type: z.array(swaggerString).optional(),
});
const contactEmail = z.object({
  email: swaggerString.optional(),
  type: z.array(swaggerString).optional(),
});
const contactNumber = z.object({
  number: swaggerString.optional(),
  type: z.array(swaggerString).optional(),
});
const contactWebsite = z.object({
  type: z.array(swaggerString).optional(),
  url: swaggerString.optional(),
});
const contactInput = z.object({
  addresses: z.array(contactAddress).optional(),
  emails: z.array(contactEmail).optional(),
  family: swaggerString.optional(),
  given: swaggerString.optional(),
  name: swaggerString.optional(),
  note: swaggerString.optional(),
  numbers: z.array(contactNumber).optional(),
  organization: z.array(z.array(swaggerString)).optional(),
  picture: swaggerString.optional(),
  scope: contactWriteScope.optional(),
  websites: z.array(contactWebsite).optional(),
});
const contactUpdateInput = contactInput.extend({ id: swaggerString.optional() });
const structuredVCardItem = z.object({
  city: swaggerString.optional(),
  country: swaggerString.optional(),
  extended: swaggerString.optional(),
  family: swaggerString.optional(),
  given: swaggerString.optional(),
  group: swaggerString.optional(),
  lat: swaggerString.optional(),
  long: swaggerString.optional(),
  middle: swaggerString.optional(),
  name: swaggerString.optional(),
  po_box: swaggerString.optional(),
  post_code: swaggerString.optional(),
  prefixes: swaggerString.optional(),
  region: swaggerString.optional(),
  street: swaggerString.optional(),
  suffixes: swaggerString.optional(),
  types: z.array(swaggerString).optional(),
  unit: z.array(swaggerString).optional(),
  value: swaggerString.optional(),
  "x-local-number": swaggerString.optional(),
  xlocalNumber: swaggerString.optional(),
});
const structuredVCardUpsert = z.object({
  contactId: swaggerString.optional(),
  item: z.record(z.string(), z.array(structuredVCardItem)).optional(),
});
const historyTypes = z.array(z.enum(["CALL", "VOICEMAIL", "SMS", "FAX"])).min(1).optional();
const historyDirections = z.array(
  z.enum(["INCOMING", "OUTGOING", "MISSED_INCOMING", "MISSED_OUTGOING"]),
).min(1).optional();
const historyStarred = z.array(z.enum(["STARRED", "UNSTARRED"])).min(1).optional();
const callRestriction = id.describe("Call restriction name, for example roaming");

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
  const accountWideConfirmation = userScoped
    ? z.literal(true).describe("Required acknowledgement that this write affects the whole sipgate account")
    : z.boolean().optional().describe("Optional acknowledgement that this write affects the whole sipgate account");
  const accountWideWriteWarning = `${changeWarning} this operation changes an account-wide sipgate resource shared by all users.`;
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
        ? "List phone numbers assigned to the authenticated user and their endpoint assignments, including device-based accounts without phonelines."
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
      description: "Check whether a quick-dial number is already taken. The check covers the whole sipgate account, including quick dials of other users.",
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
      name: "list_calls",
      description: userScoped
        ? "List currently established calls whose participants match the authenticated user's owned devices or phone numbers. Ringing calls and voicemail recordings are not included by sipgate."
        : "List all currently established account calls. Ringing calls and voicemail recordings are not included by sipgate.",
      schema: z.object({}),
      annotations: readAnnotations,
      execute: async () => backend.listCalls(),
    }),
    define({
      name: "list_notifications",
      description: "List call, fax, SMS, and voicemail notifications for one sipgate user.",
      schema: z.object({
        user_id: id.describe(userScoped
          ? "Authenticated sipgate user ID; another user's ID is rejected"
          : "sipgate user ID, for example w0"),
      }),
      annotations: readAnnotations,
      execute: async ({ user_id }) => backend.listNotifications(user_id),
    }),
    define({
      name: "list_faxlines",
      description: "List faxlines belonging to one sipgate user, including send/receive capability.",
      schema: z.object({
        user_id: id.describe(userScoped
          ? "Authenticated sipgate user ID; another user's ID is rejected"
          : "sipgate user ID, for example w0"),
      }),
      annotations: readAnnotations,
      execute: async ({ user_id }) => backend.listFaxlines(user_id),
    }),
    define({
      name: "list_faxline_numbers",
      description: "List phone numbers routed to an owned faxline.",
      schema: z.object({
        user_id: id.describe(userScoped
          ? "Authenticated sipgate user ID; another user's ID is rejected"
          : "Faxline owner user ID, for example w0"),
        faxline_id: id.describe("Faxline ID returned by list_faxlines"),
      }),
      annotations: readAnnotations,
      execute: async ({ user_id, faxline_id }) =>
        backend.listFaxlineNumbers(user_id, faxline_id),
    }),
    define({
      name: "get_phoneline",
      description: "Get one owned phoneline. Accounts without a phoneline layer return a clean unavailable result.",
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        phoneline_id: id.describe("Phoneline ID returned by get_routing or get_settings"),
      }),
      annotations: readAnnotations,
      execute: async ({ user_id, phoneline_id }) => backend.getPhoneline(user_id, phoneline_id),
    }),
    define({
      name: "get_phoneline_block_anonymous",
      description: "Get anonymous-caller blocking for one owned phoneline, or report that phonelines are unavailable.",
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        phoneline_id: id,
      }),
      annotations: readAnnotations,
      execute: async ({ user_id, phoneline_id }) =>
        backend.getPhonelineBlockAnonymous(user_id, phoneline_id),
    }),
    define({
      name: "list_phoneline_devices",
      description: "List owned devices attached to one owned phoneline, or report that phonelines are unavailable.",
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        phoneline_id: id,
      }),
      annotations: readAnnotations,
      execute: async ({ user_id, phoneline_id }) =>
        backend.listPhonelineDevices(user_id, phoneline_id),
    }),
    define({
      name: "list_parallel_forwardings",
      description: "List parallel forwardings of one owned phoneline, or report that the feature is unavailable.",
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        phoneline_id: id,
      }),
      annotations: readAnnotations,
      execute: async ({ user_id, phoneline_id }) =>
        backend.listParallelForwardings(user_id, phoneline_id),
    }),
    define({
      name: "list_phoneline_voicemails",
      description: "List voicemail extensions belonging to one owned phoneline, or report that the feature is unavailable.",
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        phoneline_id: id,
      }),
      annotations: readAnnotations,
      execute: async ({ user_id, phoneline_id }) =>
        backend.listPhonelineVoicemails(user_id, phoneline_id),
    }),
    define({
      name: "list_voicemail_greetings",
      description: "List greetings belonging to an owned voicemail on an owned phoneline.",
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        phoneline_id: id,
        voicemail_id: id,
      }),
      annotations: readAnnotations,
      execute: async ({ user_id, phoneline_id, voicemail_id }) =>
        backend.listVoicemailGreetings(user_id, phoneline_id, voicemail_id),
    }),
    define({
      name: "list_voicemails",
      description: userScoped
        ? "List only voicemail extensions that belong to the authenticated user's phonelines."
        : "List all voicemail extensions in the sipgate account.",
      schema: z.object({}),
      annotations: readAnnotations,
      execute: async () => backend.listVoicemails(),
    }),
    define({
      name: "get_voicemail",
      description: "Get one voicemail extension after verifying that it belongs to an owned phoneline.",
      schema: z.object({ voicemail_id: id }),
      annotations: readAnnotations,
      execute: async ({ voicemail_id }) => backend.getVoicemail(voicemail_id),
    }),
    define({
      name: "list_autorecording_greetings",
      description: "Get the account-wide automated call-recording announcement. This resource has no user ownership link and therefore requires administrator account scope. Call recording may incur charges; the caller is responsible for obtaining every participant's consent.",
      schema: z.object({}),
      annotations: readAnnotations,
      execute: async () => backend.listAutorecordingGreetings(),
    }),
    define({
      name: "get_autorecording_settings",
      description: "Get automated call-recording settings for an owned phoneline or faxline extension. Call recording may incur charges; the caller is responsible for obtaining every participant's consent.",
      schema: z.object({ extension: id.describe("Owned phoneline or faxline extension ID") }),
      annotations: readAnnotations,
      execute: async ({ extension }) => backend.getAutorecordingSettings(extension),
    }),
    define({
      name: "get_faxline_caller_id",
      description: "Get the caller ID configured for one owned faxline.",
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        faxline_id: id.describe("Faxline ID returned by list_faxlines"),
      }),
      annotations: readAnnotations,
      execute: async ({ user_id, faxline_id }) =>
        backend.getFaxlineCallerId(user_id, faxline_id),
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
    define({
      name: "list_contacts",
      description: "List contacts from the account-wide sipgate address book. User scope permits this account-wide read.",
      schema: z.object({
        phone_numbers: z.array(swaggerString).min(1).optional(),
        limit: z.int().min(1).default(5000),
        offset: z.int().min(0).optional().describe("Deprecated by sipgate; prefer last_id"),
        last_id: id.optional().describe("Last contact ID from the previous page"),
        scopes: z.array(contactScope).min(1).optional(),
      }),
      annotations: readAnnotations,
      execute: async ({ phone_numbers, limit, offset, last_id, scopes }) => backend.listContacts({
        limit,
        ...(phone_numbers === undefined ? {} : { phoneNumbers: phone_numbers }),
        ...(offset === undefined ? {} : { offset }),
        ...(last_id === undefined ? {} : { lastId: last_id }),
        ...(scopes === undefined ? {} : { scopes }),
      }),
    }),
    define({
      name: "get_contact",
      description: "Get one contact from the account-wide sipgate address book. User scope permits this account-wide read.",
      schema: z.object({ contact_id: id }),
      annotations: readAnnotations,
      execute: async ({ contact_id }) => backend.getContact(contact_id),
    }),
    define({
      name: "list_internal_contacts",
      description: "List account-wide internal sipgate contacts through the deprecated compatibility endpoint. Prefer list_contacts with scopes=[INTERNAL]. User scope permits this read.",
      schema: z.object({}),
      annotations: readAnnotations,
      execute: async () => backend.listInternalContacts(),
    }),
    define({
      name: "export_contacts_csv",
      description: "Export account-wide contacts as CSV text for the requested scopes. User scope permits this account-wide read.",
      schema: z.object({ scopes: z.array(contactScope).min(1) }),
      annotations: readAnnotations,
      execute: async ({ scopes }) => backend.exportContactsCsv(scopes),
    }),
    define({
      name: "get_contacts_vcard",
      description: "Get structured vCards from the account-wide sipgate address book. User scope permits this account-wide read.",
      schema: z.object({
        scopes: z.array(contactScope).min(1),
        labels: z.array(swaggerString).min(1).optional(),
        contact_ids: z.array(id).min(1).optional(),
        wanted_fields: z.array(swaggerString).min(1).optional(),
        filter: swaggerString.optional(),
        limit: z.int().min(1).default(5000),
        offset: z.int().min(0).optional().describe("Deprecated by sipgate; prefer last_id"),
        last_id: id.optional(),
      }),
      annotations: readAnnotations,
      execute: async ({ scopes, labels, contact_ids, wanted_fields, filter, limit, offset, last_id }) =>
        backend.getContactsVcard({
          scopes,
          limit,
          ...(labels === undefined ? {} : { labels }),
          ...(contact_ids === undefined ? {} : { contactIds: contact_ids }),
          ...(wanted_fields === undefined ? {} : { wantedFields: wanted_fields }),
          ...(filter === undefined ? {} : { filter }),
          ...(offset === undefined ? {} : { offset }),
          ...(last_id === undefined ? {} : { lastId: last_id }),
        }),
    }),
    define({
      name: "list_incoming_blacklist",
      description: "List the account-wide incoming-call blacklist. User scope permits this account-wide read.",
      schema: z.object({}),
      annotations: readAnnotations,
      execute: async () => backend.listIncomingBlacklist(),
    }),
    define({
      name: "list_call_restrictions",
      description: userScoped
        ? "Get call restrictions for the authenticated sipgate user; another user's ID is rejected."
        : "Get call restrictions for selected users or the whole account.",
      schema: z.object({
        user_ids: z.array(id).min(1).optional(),
      }),
      annotations: readAnnotations,
      execute: async ({ user_ids }) => backend.getCallRestrictions(user_ids),
    }),
    define({
      name: "list_restrictions",
      description: "List product/action restrictions for one sipgate user. User scope only permits the authenticated user ID.",
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "sipgate user ID"),
        restrictions: z.array(swaggerString).min(1).optional(),
      }),
      annotations: readAnnotations,
      execute: async ({ user_id, restrictions }) => backend.getRestrictions(user_id, restrictions),
    }),
    define({
      name: "export_history",
      description: userScoped
        ? "Export only the authenticated user's history as CSV text, constrained to owned connection IDs."
        : "Export account-wide history as CSV text with optional filters.",
      schema: z.object({
        connection_ids: z.array(id).min(1).optional(),
        types: historyTypes,
        directions: historyDirections,
        offset: z.int().min(0).default(0),
        limit: z.int().min(0).max(1000).default(1000),
        archived: z.boolean().optional(),
        starred: historyStarred,
        from: isoDateTime.optional(),
        to: isoDateTime.optional(),
      }).refine((value) => !value.from || !value.to || Date.parse(value.from) <= Date.parse(value.to), {
        message: "from must be before or equal to to",
        path: ["from"],
      }),
      annotations: readAnnotations,
      execute: async ({ connection_ids, types, directions, offset, limit, archived, starred, from, to }) =>
        backend.exportHistory({
          offset,
          limit,
          ...(connection_ids === undefined ? {} : { connectionIds: connection_ids }),
          ...(types === undefined ? {} : { types }),
          ...(directions === undefined ? {} : { directions }),
          ...(archived === undefined ? {} : { archived }),
          ...(starred === undefined ? {} : { starred }),
          ...(from === undefined ? {} : { from }),
          ...(to === undefined ? {} : { to }),
        }),
    }),
    define({
      name: "get_balance",
      description: "Get the account-wide sipgate balance. User scope permits this account-wide read; the amount is returned in ten-thousandths of the currency unit.",
      schema: z.object({}),
      annotations: readAnnotations,
      execute: async () => backend.getBalance(),
    }),
    define({
      name: "list_portings",
      description: "List all account-wide phone-number portings. User scope permits this account-wide read.",
      schema: z.object({}),
      annotations: readAnnotations,
      execute: async () => backend.listPortings(),
    }),
    define({
      name: "get_porting",
      description: "Get one account-wide phone-number porting. User scope permits this account-wide read.",
      schema: z.object({ porting_id: int32Id }),
      annotations: readAnnotations,
      execute: async ({ porting_id }) => backend.getPorting(porting_id),
    }),
    define({
      name: "get_sipgateio_settings",
      description: "Get the account-wide sipgate.io webhook URLs and logging configuration. User scope permits this account-wide read; unavailable plans return a clear feature-absent result.",
      schema: z.object({}),
      annotations: readAnnotations,
      execute: async () => backend.getSipgateIoSettings(),
    }),
    define({
      name: "list_webhook_logs",
      description: "List the account-wide sipgate.io webhook log. User scope permits this account-wide read; unavailable plans return a clear feature-absent result.",
      schema: z.object({}),
      annotations: readAnnotations,
      execute: async () => backend.listWebhookLogs(),
    }),
  ];

  if (readonly) return readTools;

  const writeTools = [
    define({
      name: "create_contact",
      description: `${accountWideWriteWarning} In user scope, confirm_account_wide=true is required. Creates one contact; before is null because the new contact did not exist and sipgate returns no created ID.`,
      schema: contactInput.extend({ confirm_account_wide: accountWideConfirmation }),
      annotations: actionAnnotations,
      execute: async ({ confirm_account_wide, ...contact }) =>
        backend.createContact(contact, confirm_account_wide),
    }),
    define({
      name: "update_contact",
      description: `${accountWideWriteWarning} In user scope, confirm_account_wide=true is required. Replaces one contact and returns before/after state.`,
      schema: contactUpdateInput.extend({
        contact_id: id,
        confirm_account_wide: accountWideConfirmation,
      }).refine((value) => value.id === undefined || value.id === value.contact_id, {
        message: "id must match contact_id when supplied",
        path: ["id"],
      }),
      annotations: writeAnnotations,
      execute: async ({ contact_id, confirm_account_wide, ...contact }) =>
        backend.updateContact(contact_id, contact, confirm_account_wide),
    }),
    define({
      name: "delete_contact",
      description: `${accountWideWriteWarning} PERMANENTLY deletes one contact. In user scope, confirm_account_wide=true is required. Returns the previous contact and a deletion marker.`,
      schema: z.object({
        contact_id: id,
        scopes: z.array(contactScope).min(1).optional(),
        confirm_account_wide: accountWideConfirmation,
      }),
      annotations: writeAnnotations,
      execute: async ({ contact_id, scopes, confirm_account_wide }) =>
        backend.deleteContact(contact_id, scopes, confirm_account_wide),
    }),
    define({
      name: "delete_contacts",
      description: `${accountWideWriteWarning} PERMANENTLY deletes all matching contacts, or all contacts when filters are omitted. In user scope, confirm_account_wide=true is required. Returns before state and a deletion marker.`,
      schema: z.object({
        contact_ids: z.array(id).min(1).optional(),
        scopes: z.array(contactWriteScope).min(1).optional(),
        source: swaggerString.optional(),
        confirm_account_wide: accountWideConfirmation,
      }),
      annotations: writeAnnotations,
      execute: async ({ contact_ids, scopes, source, confirm_account_wide }) =>
        backend.deleteContacts({
          ...(contact_ids === undefined ? {} : { contactIds: contact_ids }),
          ...(scopes === undefined ? {} : { scope: scopes }),
          ...(source === undefined ? {} : { source }),
        }, confirm_account_wide),
    }),
    define({
      name: "import_contacts_csv",
      description: `${accountWideWriteWarning} DESTRUCTIVE: imports base64-encoded CSV into the account-wide address book and may overwrite or duplicate contact data. In user scope, confirm_account_wide=true is required. Returns before/after contact state.`,
      schema: z.object({
        base64_content: z.string().min(1),
        confirm_account_wide: accountWideConfirmation,
      }),
      annotations: actionAnnotations,
      execute: async ({ base64_content, confirm_account_wide }) =>
        backend.importContactsCsv(base64_content, confirm_account_wide),
    }),
    define({
      name: "put_contacts_vcard",
      description: `${accountWideWriteWarning} Adds or overwrites structured vCards; a supplied contactId overwrites that contact. In user scope, confirm_account_wide=true is required. Returns before/after state.`,
      schema: z.object({
        scope: contactScope,
        data: z.array(structuredVCardUpsert).min(1),
        confirm_account_wide: accountWideConfirmation,
      }),
      annotations: writeAnnotations,
      execute: async ({ scope, data, confirm_account_wide }) =>
        backend.putContactsVcard(scope, data, confirm_account_wide),
    }),
    define({
      name: "add_incoming_blacklist",
      description: `${accountWideWriteWarning} Adds an incoming blacklist entry for the whole account. In user scope, confirm_account_wide=true is required. Returns before/after blacklist state.`,
      schema: z.object({
        phone_number: z.string().regex(/^\+?[1-9]\d{1,14}$/, "Use E.164 digits with an optional leading +"),
        is_block: z.boolean().optional().describe("Block numbers beginning with this value"),
        confirm_account_wide: accountWideConfirmation,
      }),
      annotations: actionAnnotations,
      execute: async ({ phone_number, is_block, confirm_account_wide }) =>
        backend.addIncomingBlacklist(phone_number, is_block, confirm_account_wide),
    }),
    define({
      name: "remove_incoming_blacklist",
      description: `${accountWideWriteWarning} Removes an incoming blacklist entry for the whole account. In user scope, confirm_account_wide=true is required. Returns the previous entry and a deletion marker.`,
      schema: z.object({
        phone_number: z.string().regex(/^\+?[1-9]\d{1,14}$/, "Use E.164 digits with an optional leading +"),
        confirm_account_wide: accountWideConfirmation,
      }),
      annotations: writeAnnotations,
      execute: async ({ phone_number, confirm_account_wide }) =>
        backend.removeIncomingBlacklist(phone_number, confirm_account_wide),
    }),
    define({
      name: "set_call_restriction",
      description: `${changeWarning} enable or disable one call restriction for the authenticated sipgate user. The user ID is derived from authentication and cannot target another user. Returns before/after state.`,
      schema: z.object({
        restriction: callRestriction,
        enabled: z.boolean().optional(),
      }),
      annotations: writeAnnotations,
      execute: async ({ restriction, enabled }) => backend.setCallRestriction(restriction, enabled),
    }),
    define({
      name: "set_history_read",
      description: `${changeWarning} mark one owned history entry read or unread. Returns before/after state.`,
      schema: z.object({ entry_id: id, value: z.boolean().optional() }),
      annotations: writeAnnotations,
      execute: async ({ entry_id, value }) => backend.setHistoryRead(entry_id, value),
    }),
    define({
      name: "set_history_note",
      description: `${changeWarning} replace the note on one owned history entry. Returns before/after state.`,
      schema: z.object({ entry_id: id, note: swaggerString }),
      annotations: writeAnnotations,
      execute: async ({ entry_id, note }) => backend.setHistoryNote(entry_id, note),
    }),
    define({
      name: "set_history_archive",
      description: `${changeWarning} archive or unarchive one owned history entry. Returns before/after state.`,
      schema: z.object({ entry_id: id, value: z.boolean().optional() }),
      annotations: writeAnnotations,
      execute: async ({ entry_id, value }) => backend.setHistoryArchive(entry_id, value),
    }),
    define({
      name: "update_history_entry",
      description: `${changeWarning} update archived, note, read, and/or starred state on one owned history entry. Returns before/after state.`,
      schema: z.object({
        entry_id: id,
        archived: z.boolean().optional(),
        note: swaggerString.optional(),
        read: z.boolean().optional(),
        starred: z.boolean().optional(),
      }),
      annotations: writeAnnotations,
      execute: async ({ entry_id, archived, note, read, starred }) =>
        backend.updateHistoryEntry(entry_id, {
          ...(archived === undefined ? {} : { archived }),
          ...(note === undefined ? {} : { note }),
          ...(read === undefined ? {} : { read }),
          ...(starred === undefined ? {} : { starred }),
        }),
    }),
    define({
      name: "delete_history_entry",
      description: `${changeWarning} PERMANENTLY delete one owned call, fax, SMS, or voicemail history entry. This is irreversible. Returns the previous entry and a deletion marker.`,
      schema: z.object({ entry_id: id }),
      annotations: writeAnnotations,
      execute: async ({ entry_id }) => backend.deleteHistoryEntry(entry_id),
    }),
    define({
      name: "update_history_entries",
      description: `${changeWarning} update fewer than 150 owned history entries in one request. User scope verifies every entry ID. Returns before/after state.`,
      schema: z.object({
        entries: z.array(z.object({
          id,
          archived: z.boolean().optional(),
          read: z.boolean().optional(),
          starred: z.boolean().optional(),
        })).min(1).max(149),
      }),
      annotations: writeAnnotations,
      execute: async ({ entries }) => backend.updateHistoryEntries(entries),
    }),
    define({
      name: "delete_history_entries",
      description: `${changeWarning} PERMANENTLY delete selected history entries, or all accessible history when entry_ids is omitted. This is irreversible. In user scope, omission is expanded to owned entry IDs and never sends an unconstrained account-wide DELETE. Returns previous state and a deletion marker.`,
      schema: z.object({ entry_ids: z.array(id).min(1).optional() }),
      annotations: writeAnnotations,
      execute: async ({ entry_ids }) => backend.deleteHistoryEntries(entry_ids),
    }),
    define({
      name: "cancel_porting",
      description: `${accountWideWriteWarning} IRREVERSIBLY cancels an account-wide phone-number porting. confirm_account_wide=true is always required. Returns the previous porting and the cancellation response.`,
      schema: z.object({
        porting_id: int32Id,
        confirm_account_wide: z.literal(true),
      }),
      annotations: writeAnnotations,
      execute: async ({ porting_id, confirm_account_wide }) =>
        backend.cancelPorting(porting_id, confirm_account_wide),
    }),
    define({
      name: "update_sipgateio_settings",
      description: `${accountWideWriteWarning} Replaces global sipgate.io incoming/outgoing webhook URLs and related settings. In user scope, confirm_account_wide=true is required. Returns before/after state or a clear unavailable result.`,
      schema: z.object({
        incoming_url: swaggerString,
        outgoing_url: swaggerString,
        log: z.boolean().optional(),
        push_api_version: int32Id.optional(),
        whitelist: z.array(swaggerString).optional(),
        confirm_account_wide: accountWideConfirmation,
      }),
      annotations: writeAnnotations,
      execute: async ({ incoming_url, outgoing_url, log, push_api_version, whitelist, confirm_account_wide }) =>
        backend.updateSipgateIoSettings({
          incomingUrl: incoming_url,
          outgoingUrl: outgoing_url,
          ...(log === undefined ? {} : { log }),
          ...(push_api_version === undefined ? {} : { pushApiVersion: push_api_version }),
          ...(whitelist === undefined ? {} : { whitelist }),
        }, confirm_account_wide),
    }),
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
      name: "create_phoneline",
      description: `${changeWarning} create a phoneline for the authenticated user. Provisioning may affect billing; returns before: null and the initial state, or a clean unavailable result.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
      }),
      annotations: actionAnnotations,
      execute: async ({ user_id }) => backend.createPhoneline(user_id),
    }),
    define({
      name: "update_phoneline_alias",
      description: `${changeWarning} update an owned phoneline alias. Returns before/after state or a clean unavailable result.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        phoneline_id: id,
        alias: swaggerString.optional(),
      }),
      annotations: writeAnnotations,
      execute: async ({ user_id, phoneline_id, alias }) =>
        backend.updatePhonelineAlias(user_id, phoneline_id, alias),
    }),
    define({
      name: "delete_phoneline",
      description: `${changeWarning} permanently delete an owned phoneline. Returns its previous state and a deletion marker, or a clean unavailable result.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        phoneline_id: id,
      }),
      annotations: writeAnnotations,
      execute: async ({ user_id, phoneline_id }) => backend.deletePhoneline(user_id, phoneline_id),
    }),
    define({
      name: "set_phoneline_block_anonymous",
      description: `${changeWarning} configure anonymous-caller rejection or voicemail routing on an owned phoneline. Returns before/after state.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        phoneline_id: id,
        enabled: z.boolean().optional(),
        target: z.enum(["REJECT", "VOICEMAIL"]).optional(),
      }),
      annotations: writeAnnotations,
      execute: async ({ user_id, phoneline_id, enabled, target }) =>
        backend.setPhonelineBlockAnonymous(user_id, phoneline_id, {
          ...(enabled === undefined ? {} : { enabled }),
          ...(target === undefined ? {} : { target }),
        }),
    }),
    define({
      name: "attach_device_to_phoneline",
      description: `${changeWarning} attach an owned device to an owned phoneline. Returns the complete before/after device assignment.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        phoneline_id: id,
        device_id: id.describe("Owned device ID returned by list_devices"),
      }),
      annotations: actionAnnotations,
      execute: async ({ user_id, phoneline_id, device_id }) =>
        backend.attachDeviceToPhoneline(user_id, phoneline_id, device_id),
    }),
    define({
      name: "detach_device_from_phoneline",
      description: `${changeWarning} detach an owned device from an owned phoneline. Returns the complete before/after device assignment.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        phoneline_id: id,
        device_id: id.describe("Owned device ID returned by list_phoneline_devices"),
      }),
      annotations: writeAnnotations,
      execute: async ({ user_id, phoneline_id, device_id }) =>
        backend.detachDeviceFromPhoneline(user_id, phoneline_id, device_id),
    }),
    define({
      name: "create_parallel_forwarding",
      description: `${changeWarning} create a parallel forwarding on an owned phoneline. Returns the complete before/after forwarding list.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        phoneline_id: id,
        active: z.boolean().optional(),
        alias: swaggerString.optional(),
        destination: swaggerString.optional(),
      }),
      annotations: actionAnnotations,
      execute: async ({ user_id, phoneline_id, active, alias, destination }) =>
        backend.createParallelForwarding(user_id, phoneline_id, {
          ...(active === undefined ? {} : { active }),
          ...(alias === undefined ? {} : { alias }),
          ...(destination === undefined ? {} : { destination }),
        }),
    }),
    define({
      name: "update_parallel_forwarding",
      description: `${changeWarning} update a parallel forwarding belonging to an owned phoneline. Returns the complete before/after forwarding list.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        phoneline_id: id,
        parallel_forwarding_id: id,
        active: z.boolean().optional(),
        alias: swaggerString.optional(),
        destination: swaggerString.optional(),
      }),
      annotations: writeAnnotations,
      execute: async ({
        user_id,
        phoneline_id,
        parallel_forwarding_id,
        active,
        alias,
        destination,
      }) => backend.updateParallelForwarding(
        user_id,
        phoneline_id,
        parallel_forwarding_id,
        {
          ...(active === undefined ? {} : { active }),
          ...(alias === undefined ? {} : { alias }),
          ...(destination === undefined ? {} : { destination }),
        },
      ),
    }),
    define({
      name: "delete_parallel_forwarding",
      description: `${changeWarning} delete a parallel forwarding belonging to an owned phoneline. Returns the complete before/after forwarding list.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        phoneline_id: id,
        parallel_forwarding_id: id,
      }),
      annotations: writeAnnotations,
      execute: async ({ user_id, phoneline_id, parallel_forwarding_id }) =>
        backend.deleteParallelForwarding(user_id, phoneline_id, parallel_forwarding_id),
    }),
    define({
      name: "update_voicemail",
      description: `${changeWarning} update an owned phoneline voicemail's active, timeout, and transcription settings. Returns before/after voicemail lists.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        phoneline_id: id,
        voicemail_id: id,
        active: z.boolean(),
        transcription: z.boolean(),
        timeout: z.int().min(0).max(2_147_483_647).optional(),
      }),
      annotations: writeAnnotations,
      execute: async ({ user_id, phoneline_id, voicemail_id, active, transcription, timeout }) =>
        backend.updateVoicemail(user_id, phoneline_id, voicemail_id, {
          active,
          transcription,
          ...(timeout === undefined ? {} : { timeout }),
        }),
    }),
    define({
      name: "create_voicemail_greeting",
      description: `${changeWarning} upload a greeting for an owned phoneline voicemail. Returns the complete before/after greeting list.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        phoneline_id: id,
        voicemail_id: id,
        base64_content: z.string().max(15_000_000).optional(),
        filename: swaggerString.optional(),
      }),
      annotations: actionAnnotations,
      execute: async ({ user_id, phoneline_id, voicemail_id, base64_content, filename }) =>
        backend.createVoicemailGreeting(user_id, phoneline_id, voicemail_id, {
          ...(base64_content === undefined ? {} : { base64Content: base64_content }),
          ...(filename === undefined ? {} : { filename }),
        }),
    }),
    define({
      name: "update_voicemail_greeting",
      description: `${changeWarning} activate or deactivate a greeting belonging to an owned phoneline voicemail. Returns the complete before/after greeting list.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        phoneline_id: id,
        voicemail_id: id,
        greeting_id: id,
        active: z.boolean().optional(),
      }),
      annotations: writeAnnotations,
      execute: async ({ user_id, phoneline_id, voicemail_id, greeting_id, active }) =>
        backend.updateVoicemailGreeting(
          user_id,
          phoneline_id,
          voicemail_id,
          greeting_id,
          active,
        ),
    }),
    define({
      name: "delete_voicemail_greeting",
      description: `${changeWarning} delete a greeting belonging to an owned phoneline voicemail. Returns the complete before/after greeting list.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        phoneline_id: id,
        voicemail_id: id,
        greeting_id: id,
      }),
      annotations: writeAnnotations,
      execute: async ({ user_id, phoneline_id, voicemail_id, greeting_id }) =>
        backend.deleteVoicemailGreeting(user_id, phoneline_id, voicemail_id, greeting_id),
    }),
    define({
      name: "set_voicemail_transcription",
      description: `${changeWarning} enable or disable transcription for an owned phoneline voicemail. Transcription availability and pricing depend on the account. Returns before/after voicemail lists.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        phoneline_id: id,
        voicemail_id: id,
        active: z.boolean().optional(),
      }),
      annotations: writeAnnotations,
      execute: async ({ user_id, phoneline_id, voicemail_id, active }) =>
        backend.setVoicemailTranscription(user_id, phoneline_id, voicemail_id, active),
    }),
    define({
      name: "play_voicemail",
      description: `${changeWarning} initiate a call to play an owned voicemail recording on an owned device. THE CALL MAY INCUR CHARGES. The caller is responsible for any consent required for recording playback. before is null because sipgate exposes no synchronous session read-back.`,
      schema: z.object({
        data_id: id.optional().describe("Voicemail data/history ID; required in user scope for ownership"),
        device_id: id.optional().describe("Playback device ID; required in user scope for ownership"),
      }),
      annotations: actionAnnotations,
      execute: async ({ data_id, device_id }) => backend.playVoicemail({
        ...(data_id === undefined ? {} : { dataId: data_id }),
        ...(device_id === undefined ? {} : { deviceId: device_id }),
      }),
    }),
    define({
      name: "record_voicemail_greeting",
      description: `${changeWarning} initiate a call on an owned device to record a greeting for an owned voicemail. THE CALL MAY INCUR CHARGES. The caller is responsible for consent where recording law requires it. before is null because sipgate exposes no synchronous session read-back.`,
      schema: z.object({
        device_id: id.optional().describe("Recording device ID; required in user scope for ownership"),
        endpoint: swaggerString.optional(),
        target_id: id.optional().describe("Target voicemail ID; required in user scope for ownership"),
      }),
      annotations: actionAnnotations,
      execute: async ({ device_id, endpoint, target_id }) => backend.recordVoicemailGreeting({
        ...(device_id === undefined ? {} : { deviceId: device_id }),
        ...(endpoint === undefined ? {} : { endpoint }),
        ...(target_id === undefined ? {} : { targetId: target_id }),
      }),
    }),
    define({
      name: "create_autorecording_greeting",
      description: `${changeWarning} replace the account-wide automated call-recording announcement. This resource has no user ownership link and therefore requires administrator account scope. Call recording may incur charges; the caller is responsible for obtaining every participant's consent. Returns before/after greeting state.`,
      schema: z.object({
        base64_content: z.string().max(15_000_000).optional(),
        filename: swaggerString.optional(),
      }),
      annotations: actionAnnotations,
      execute: async ({ base64_content, filename }) => backend.createAutorecordingGreeting({
        ...(base64_content === undefined ? {} : { base64Content: base64_content }),
        ...(filename === undefined ? {} : { filename }),
      }),
    }),
    define({
      name: "delete_autorecording_greeting",
      description: `${changeWarning} delete the account-wide automated call-recording announcement. This resource has no user ownership link and therefore requires administrator account scope. Call recording may incur charges; the caller is responsible for obtaining every participant's consent. Returns previous state and a deletion marker.`,
      schema: z.object({ greeting_id: id }),
      annotations: writeAnnotations,
      execute: async ({ greeting_id }) => backend.deleteAutorecordingGreeting(greeting_id),
    }),
    define({
      name: "set_autorecording_settings",
      description: `${changeWarning} enable or disable automated call recording for an owned phoneline or faxline extension. Recording may incur charges; the caller is responsible for obtaining every participant's consent. Returns before/after state.`,
      schema: z.object({
        extension: id.describe("Owned phoneline or faxline extension ID"),
        active: z.boolean().optional(),
      }),
      annotations: writeAnnotations,
      execute: async ({ extension, active }) => backend.setAutorecordingSettings(extension, active),
    }),
    define({
      name: "create_faxline",
      description: `${changeWarning} create a faxline for the authenticated user. Provisioning may affect billing; returns before: null and the initial state.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
      }),
      annotations: actionAnnotations,
      execute: async ({ user_id }) => backend.createFaxline(user_id),
    }),
    define({
      name: "update_faxline_alias",
      description: `${changeWarning} update the alias of an owned faxline. Returns before/after faxline state.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        faxline_id: id,
        alias: swaggerString.optional(),
      }),
      annotations: writeAnnotations,
      execute: async ({ user_id, faxline_id, alias }) =>
        backend.updateFaxlineAlias(user_id, faxline_id, alias),
    }),
    define({
      name: "delete_faxline",
      description: `${changeWarning} permanently delete an owned faxline. Returns its previous state and a deletion marker.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        faxline_id: id,
      }),
      annotations: writeAnnotations,
      execute: async ({ user_id, faxline_id }) => backend.deleteFaxline(user_id, faxline_id),
    }),
    define({
      name: "set_faxline_caller_id",
      description: `${changeWarning} set an owned faxline's caller ID to an owned phone number. Returns before/after caller-ID state.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        faxline_id: id,
        value: swaggerString.optional(),
      }),
      annotations: writeAnnotations,
      execute: async ({ user_id, faxline_id, value }) =>
        backend.setFaxlineCallerId(user_id, faxline_id, value),
    }),
    define({
      name: "set_faxline_tagline",
      description: `${changeWarning} update the tagline of an owned faxline. Returns before/after faxline state.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        faxline_id: id,
        value: swaggerString.optional(),
      }),
      annotations: writeAnnotations,
      execute: async ({ user_id, faxline_id, value }) =>
        backend.setFaxlineTagline(user_id, faxline_id, value),
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
    define({
      name: "create_call_email_notification",
      description: `${changeWarning} create an email notification for calls on an owned endpoint. Returns the complete before/after notification state.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        endpoint_id: id.describe("Owned device or phoneline ID"),
        cause: z.enum(["MISSED", "SUCCESSFUL"]),
        direction: z.enum(["INCOMING", "OUTGOING"]),
        email: swaggerString,
      }),
      annotations: actionAnnotations,
      execute: async ({ user_id, endpoint_id, cause, direction, email }) =>
        backend.createCallEmailNotification({
          userId: user_id,
          endpointId: endpoint_id,
          cause,
          direction,
          email,
        }),
    }),
    define({
      name: "create_call_sms_notification",
      description: `${changeWarning} create an SMS notification for calls on an owned endpoint. Returns the complete before/after notification state.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        endpoint_id: id.describe("Owned device or phoneline ID"),
        cause: z.enum(["MISSED", "SUCCESSFUL"]),
        direction: z.enum(["INCOMING", "OUTGOING"]),
        number: e164,
      }),
      annotations: actionAnnotations,
      execute: async ({ user_id, endpoint_id, cause, direction, number }) =>
        backend.createCallSmsNotification({
          userId: user_id,
          endpointId: endpoint_id,
          cause,
          direction,
          number,
        }),
    }),
    define({
      name: "create_fax_email_notification",
      description: `${changeWarning} create an email notification for incoming or outgoing faxes on an owned faxline. Returns before/after notification state.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        faxline_id: id.describe("Faxline ID returned by list_faxlines"),
        direction: z.enum(["INCOMING", "OUTGOING"]),
        email: swaggerString,
      }),
      annotations: actionAnnotations,
      execute: async ({ user_id, faxline_id, direction, email }) =>
        backend.createFaxEmailNotification({
          userId: user_id,
          faxlineId: faxline_id,
          direction,
          email,
        }),
    }),
    define({
      name: "create_fax_sms_notification",
      description: `${changeWarning} create an SMS notification for incoming or outgoing faxes on an owned faxline. Returns before/after notification state.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        faxline_id: id.describe("Faxline ID returned by list_faxlines"),
        direction: z.enum(["INCOMING", "OUTGOING"]),
        number: e164,
      }),
      annotations: actionAnnotations,
      execute: async ({ user_id, faxline_id, direction, number }) =>
        backend.createFaxSmsNotification({
          userId: user_id,
          faxlineId: faxline_id,
          direction,
          number,
        }),
    }),
    define({
      name: "create_fax_report_notification",
      description: `${changeWarning} create an email delivery-report notification for an owned faxline. Returns before/after notification state.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        faxline_id: id.describe("Faxline ID returned by list_faxlines"),
        email: swaggerString,
      }),
      annotations: actionAnnotations,
      execute: async ({ user_id, faxline_id, email }) =>
        backend.createFaxReportNotification({
          userId: user_id,
          faxlineId: faxline_id,
          email,
        }),
    }),
    define({
      name: "create_sms_email_notification",
      description: `${changeWarning} create an email notification for incoming SMS on a user SMS endpoint. Returns before/after notification state.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        endpoint_id: id.describe("SMS endpoint ID, for example y0"),
        email: swaggerString,
      }),
      annotations: actionAnnotations,
      execute: async ({ user_id, endpoint_id, email }) =>
        backend.createSmsEmailNotification({
          userId: user_id,
          endpointId: endpoint_id,
          email,
        }),
    }),
    define({
      name: "create_voicemail_email_notification",
      description: `${changeWarning} create an email notification for a user voicemail. Returns before/after notification state.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        voicemail_id: id.describe("Voicemail ID, for example v0"),
        email: swaggerString,
      }),
      annotations: actionAnnotations,
      execute: async ({ user_id, voicemail_id, email }) =>
        backend.createVoicemailEmailNotification({
          userId: user_id,
          voicemailId: voicemail_id,
          email,
        }),
    }),
    define({
      name: "create_voicemail_sms_notification",
      description: `${changeWarning} create an SMS notification for a user voicemail. Returns before/after notification state.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        voicemail_id: id.describe("Voicemail ID, for example v0"),
        number: e164,
      }),
      annotations: actionAnnotations,
      execute: async ({ user_id, voicemail_id, number }) =>
        backend.createVoicemailSmsNotification({
          userId: user_id,
          voicemailId: voicemail_id,
          number,
        }),
    }),
    define({
      name: "delete_notification",
      description: `${changeWarning} delete a notification after verifying that its nested notification ID belongs to the selected user. Returns before/after notification state.`,
      schema: z.object({
        user_id: id.describe(userScoped ? "Authenticated sipgate user ID" : "Owner user ID"),
        notification_id: id.describe("Notification target ID returned by list_notifications"),
      }),
      annotations: writeAnnotations,
      execute: async ({ user_id, notification_id }) =>
        backend.deleteNotification(user_id, notification_id),
    }),
    define({
      name: "hangup_call",
      description: `${changeWarning} hang up an established call after verifying participant ownership. Returns the call before the hangup and its post-operation state.`,
      schema: z.object({ call_id: id.describe("Call ID returned by list_calls") }),
      annotations: writeAnnotations,
      execute: async ({ call_id }) => backend.hangupCall(call_id),
    }),
    define({
      name: "set_call_hold",
      description: `${changeWarning} hold or resume all participants in an owned established call. Returns before/after call state.`,
      schema: z.object({
        call_id: id.describe("Call ID returned by list_calls"),
        value: z.boolean().describe("true to hold; false to resume"),
      }),
      annotations: writeAnnotations,
      execute: async ({ call_id, value }) => backend.setCallHold(call_id, value),
    }),
    define({
      name: "set_call_muted",
      description: `${changeWarning} mute or unmute yourself in an owned established call. sipgate does not support this for Neo PBX accounts. Returns before/after call state.`,
      schema: z.object({
        call_id: id.describe("Call ID returned by list_calls"),
        value: z.boolean().describe("true to mute; false to unmute"),
      }),
      annotations: writeAnnotations,
      execute: async ({ call_id, value }) => backend.setCallMuted(call_id, value),
    }),
    define({
      name: "set_call_recording",
      description: `${changeWarning} start or stop recording an owned call; recording may incur charges and is legally sensitive in Germany. The caller is responsible for obtaining every participant's consent. Returns before/after call state.`,
      schema: z.object({
        call_id: id.describe("Call ID returned by list_calls"),
        value: z.boolean().describe("true to start; false to stop recording"),
        announcement: z.boolean().optional()
          .describe("Whether sipgate announces recording start/stop; defaults to sipgate's true setting"),
      }),
      annotations: writeAnnotations,
      execute: async ({ call_id, value, announcement }) =>
        backend.setCallRecording(call_id, value, announcement),
    }),
    define({
      name: "transfer_call",
      description: `${changeWarning} transfer an owned established call to another phone number. Returns before/after call state.`,
      schema: z.object({
        call_id: id.describe("Call ID returned by list_calls"),
        attended: z.boolean().describe("true for attended; false for blind transfer"),
        phone_number: dialString.describe("Transfer target phone number"),
        caller_id: e164.optional().describe("Optional owned caller ID for the transfer"),
      }),
      annotations: actionAnnotations,
      execute: async ({ call_id, attended, phone_number, caller_id }) =>
        backend.transferCall(call_id, {
          attended,
          phoneNumber: phone_number,
          ...(caller_id === undefined ? {} : { callerId: caller_id }),
        }),
    }),
    define({
      name: "send_call_dtmf",
      description: `${changeWarning} send a DTMF sequence to every participant in an owned established call. Returns before/after call state.`,
      schema: z.object({
        call_id: id.describe("Call ID returned by list_calls"),
        sequence: swaggerString.describe("DTMF sequence, for example 123456"),
      }),
      annotations: actionAnnotations,
      execute: async ({ call_id, sequence }) => backend.sendCallDtmf(call_id, sequence),
    }),
    define({
      name: "start_call_announcement",
      description: `${changeWarning} play a mono 16-bit PCM WAV announcement at 8 kHz to all participants in an owned call. sipgate does not support this for Neo PBX accounts. Returns before/after call state.`,
      schema: z.object({
        call_id: id.describe("Call ID returned by list_calls"),
        url: swaggerString.describe("Public URL of the announcement WAV file"),
      }),
      annotations: actionAnnotations,
      execute: async ({ call_id, url }) => backend.startCallAnnouncement(call_id, url),
    }),
    define({
      name: "send_fax",
      description: `${changeWarning} send a PDF fax from an owned faxline. SENDING A FAX INCURS CHARGES. The API has no synchronous fax-state read-back, so before is null and after includes the session response and an explicit note.`,
      schema: z.object({
        faxline_id: id.describe("Faxline ID returned by list_faxlines"),
        recipient: dialString,
        filename: swaggerString.describe("Fax document filename, for example fax.pdf"),
        base64_content: z.string().max(28_330_000)
          .describe("Base64-encoded PDF content; sipgate's maximum is 28,330,000 characters"),
      }),
      annotations: actionAnnotations,
      execute: async ({ faxline_id, recipient, filename, base64_content }) => backend.sendFax({
        faxlineId: faxline_id,
        recipient,
        filename,
        base64Content: base64_content,
      }),
    }),
    define({
      name: "resend_fax",
      description: `${changeWarning} resend an existing fax. RESENDING A FAX INCURS CHARGES. User scope requires an owned faxline ID so ownership can be established; before is null because sipgate exposes no fax-session read-back here.`,
      schema: z.object({
        fax_id: id.describe("Fax ID to resend"),
        faxline_id: (userScoped ? id : id.optional()).describe(userScoped
          ? "Required owned faxline ID returned by list_faxlines"
          : "Optional faxline ID; sipgate otherwise reuses the original faxline"),
      }),
      annotations: actionAnnotations,
      execute: async ({ fax_id, faxline_id }) => backend.resendFax({
        faxId: fax_id,
        ...(faxline_id === undefined ? {} : { faxlineId: faxline_id }),
      }),
    }),
  ];

  return [...readTools, ...writeTools];
}
