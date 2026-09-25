# Changelog

## 0.6.0 - 2026-09-25

Breaking: 18 tools are renamed so that every tool name fits the 28-character
limit sipgate's AI agent sona applies to connected MCP tools. Backend method
names and behaviour are unchanged; update client allowlists and saved prompts.

| Before (0.5.x) | Since 0.6.0 |
| --- | --- |
| `set_external_device_target_number` | `set_external_device_target` |
| `set_external_device_incoming_call_display` | `set_external_device_display` |
| `get_device_tariff_announcement` | `get_tariff_announcement` |
| `set_device_tariff_announcement` | `set_tariff_announcement` |
| `get_device_single_row_display` | `get_single_row_display` |
| `set_device_single_row_display` | `set_single_row_display` |
| `get_phoneline_block_anonymous` | `get_anonymous_call_blocking` |
| `set_phoneline_block_anonymous` | `set_anonymous_call_blocking` |
| `create_autorecording_greeting` | `create_recording_greeting` |
| `delete_autorecording_greeting` | `delete_recording_greeting` |
| `create_call_email_notification` | `create_call_email_alert` |
| `create_call_sms_notification` | `create_call_sms_alert` |
| `create_fax_email_notification` | `create_fax_email_alert` |
| `create_fax_sms_notification` | `create_fax_sms_alert` |
| `create_fax_report_notification` | `create_fax_report_alert` |
| `create_sms_email_notification` | `create_sms_email_alert` |
| `create_voicemail_email_notification` | `create_voicemail_email_alert` |
| `create_voicemail_sms_notification` | `create_voicemail_sms_alert` |

- Make `user_id` optional in user scope. It defaults to the authenticated user
  before anything is delegated, so an agent no longer has to look up its own ID
  first; 49 tools, including `send_sms`, previously required it. An explicit
  foreign ID is still rejected, and account scope still requires the ID.
- Add `list_phonelines`. Nine tools need a `phoneline_id`, and the backend
  already implemented the listing, but no tool exposed it.
- Report a write that sipgate accepted as applied when a later step of the same
  tool call fails. Reading the result back after a successful `send_sms`,
  Click2Dial, call control, or any other write used to surface as a plain,
  retryable error, which invited a second SMS or call. The result now says
  `applied: true`, lists the accepted requests with any session or call ID, and
  says not to repeat the action. A later failed write names the requests that
  were already accepted.
- Advertise fields with defaults as optional in the tool schemas. `offset` and
  `limit` of `list_numbers`, `call_history`, `export_history`, `list_contacts`,
  and `get_contacts_vcard` were listed as required.
- Bound every request: each attempt has a 30-second deadline that covers the
  response headers and the body. A write that times out, loses the connection,
  or gets a server error is reported as possibly applied, so an agent checks
  the state instead of sending it again. A write whose confirmation body is not
  JSON is treated as accepted.
- Retry a read once when sipgate answers HTTP 429 or 503, honouring
  `Retry-After` (seconds or HTTP date) up to 5 seconds. Longer waits are
  reported instead of blocking the tool call, and writes are never retried.
- Stop passing sipgate's error text into tool results. Only denial sentences
  sipgate is known to send are shown, quoted from a built-in list; any other
  body is dropped. Before, any short plain-text body passed, including one that
  echoed the raw PAT or read like an instruction. `Retry-After` is parsed and
  no longer echoed, and every error message is scrubbed of the configured
  PAT-ID, PAT, and Basic credential.
- Read paginated results through one bounded helper. It follows the
  `nextOffset` of filtered history pages, so bulk history deletion on accounts
  without history extensions no longer stops after the first page and leaves
  owned entries behind. Offsets advance by what sipgate returned, a
  continuation that does not move forward is an error, and a misbehaving
  endpoint stops after 100 pages. `call_history` no longer invents a total when
  sipgate omits it, and reports a next offset after a full page.
- Bound the contact cursor used by bulk contact deletion and CSV import, and
  refuse a cursor that repeats instead of truncating the snapshot silently.
- Require `limit >= 1` for `export_history`, matching `call_history`.
- Describe where `faxline_id` and `phoneline_id` values come from, and link the
  alert tools to `list_notifications` and `delete_notification`.
- Correct the README's error-handling claims, list npm first in the setup
  skill, and sync `package-lock.json`, which still said 0.5.1.
- Add HTTP-level tests for `account_info`, `list_users`, `list_numbers`,
  `list_devices`, `call_history`, and account-scope Click2Dial, plus tests that
  keep every tool name unique and at most 28 characters long.

## 0.5.2 - 2026-08-30

- Never send device IDs as history connection filters. sipgate answers HTTP 403
  for them and accepts only real extensions, so `call_history` failed on every
  account whose user owns devices but no phoneline. Accounts with no filterable
  extension now read the history unfiltered and keep the entries that match the
  user's own numbers.
- Pass through sipgate's own plain-text denial reason. The phoneline endpoints
  answer "This endpoint requires a sipgate Classic PBX Account", which is worth
  more than any guess about token scopes. Structured bodies are still withheld.

## 0.5.1 - 2026-08-30

- List user numbers from sipgate's own user-number endpoint instead of matching
  account numbers against device endpoints. Numbers that are assigned to a user
  but routed nowhere carry an empty `endpointId`, so the endpoint match dropped
  them and `list_numbers` came back empty on a real account.
- Name the denied endpoint in HTTP 403 errors. One denied endpoint no longer
  reads as a blanket token or account problem when the rest of the API works.

## 0.5.0 - 2026-08-30
- Add the final 32 tools for contacts, incoming blocklists, call/product
  restrictions, history updates/deletes/CSV export, balance, portings,
  account-wide sipgate.io settings, and webhook logs using the exact v2 paths,
  verbs, query parameters, and request bodies.
- Permit account-wide contact, blacklist, balance, porting, sipgate.io, and
  webhook-log reads in user scope. Require `confirm_account_wide: true` for
  account-wide contact/blacklist writes, sipgate.io updates in user scope, and
  every porting cancellation.
- Verify every single and bulk history mutation against owned history entries.
  When user scope requests bulk deletion without IDs, enumerate both archived
  and unarchived entries through owned connection IDs and send only those IDs;
  never issue an unconstrained account-wide `DELETE /history`.
- Return `{before, after}` for all new mutations, including explicit
  no-read-back/deletion notes. Mark contact CSV import, contact/history
  deletion, and porting cancellation as destructive or irreversible.
- Add raw-text transport for contact/history CSV exports and explicit
  403/404-unavailable results for sipgate.io settings and webhook logs.
- Add 35 phoneline, voicemail/greeting, automated-recording, and faxline-
  configuration tools covering every requested GET/POST/PUT/DELETE operation,
  with exact v2 paths and payloads.
- Add phoneline detail, anonymous-call blocking, attached-device, and parallel-
  forwarding reads/writes; enforce authenticated-user, owned-phoneline,
  owned-device, and nested-forwarding boundaries.
- Add phoneline voicemail settings, greeting upload/activation/deletion,
  transcription, global voicemail reads, and voicemail playback/recording call
  sessions. Global results are filtered to voicemail IDs discovered under the
  authenticated user's phonelines.
- Add automated call-recording announcement and per-extension settings. User
  scope accepts settings only for an owned phoneline or faxline extension. The
  account-global announcement has no user ownership link, so its read/create/
  delete operations require administrator account scope.
- Add faxline creation, alias/deletion, caller-ID reads/writes, and tagline
  updates with owned-faxline and owned-caller-number checks.
- Return explicit `phonelinesAvailable: false` / `changed: false` results for
  phoneline-only tools when sipgate returns 403/404, without attempting a
  mutation. An available but empty phoneline collection still denies access.
- Warn that voicemail call sessions and recording features may incur charges,
  and that callers remain responsible for legally required recording consent.
- Expand read-only registration to 47 read tools and the full write-enabled
  surface to 129 tools. Add one definition and backend endpoint test per new
  tool plus foreign-resource and phoneline-less access-policy coverage.
- Add notification listing, creation, and deletion for call email/SMS, fax
  email/SMS/report, incoming-SMS email, and voicemail email/SMS targets.
- Expose established calls and add hangup, hold, mute, recording, transfer,
  DTMF, and announcement controls with before/after call snapshots.
- Add faxline and faxline-number reads plus chargeable fax send and resend
  actions using sipgate's documented session payloads.
- Restrict user-scoped active calls to participants matching owned devices or
  phone numbers, verify nested notification IDs before deletion, and verify
  faxline ownership for reads, notifications, sends, and resends. Unknown or
  unreadable ownership fails closed.
- Warn explicitly that fax transmission incurs charges and that call recording
  can incur charges and requires participant consent in Germany.
- Keep a shared emergency address from leaking or rewriting other users' data:
  user scope filters foreign numbers out of an address's number list and
  refuses to edit an address that other users' numbers are attached to.
- Establish number ownership from the direct user-number endpoint as well as
  routing, so quick dials that no phoneline or device routes can still be
  updated and deleted by their owner.
- Page through every owned number when deciding ownership instead of stopping
  after 1000.
- Redact PUK and ICCID values that arrive outside a credentials wrapper.
- Establish active-call ownership from the participant sipgate marks as the
  call owner. Being the remote party of another user's call is not ownership,
  and a call without a marked owner is denied.
- Verify that a resent fax belongs to the authenticated user, not just that the
  faxline does.
- Accept national phone formats for transfer targets and fax recipients, which
  the API documents as plain strings.
- Report the observed HTTP status when a phoneline or recording feature is
  unavailable, so a denied token scope is no longer indistinguishable from an
  account that simply has no phoneline layer.
- Say explicitly when a phoneline change was applied but only its read-back was
  denied, instead of reporting the feature as unavailable.
- Accept an owned device as an automated-recording extension; sipgate documents
  that feature for register endpoints, not only phonelines and faxlines.
- Refuse to delete an automated-recording greeting other than the one currently
  configured.
- Refuse a history deletion whose entry list is present but empty. An empty
  list serializes to no query parameter, which sipgate reads as "delete the
  entire account history".
- Enforce the account-wide confirmation inside SipgateBackend as well, not only
  at the access-control boundary, since the backend is exported on its own.
- Reject a bulk history update at sipgate's documented limit of 150 entries.
- Strip query strings from webhook log URLs, which carry their credentials
  there as plain strings that key-based redaction cannot see.

- Add complete self-service tools for the requested sipgate v2 device surface:
  device reads, updates and deletion; aliases; caller ID; local prefix; tariff
  announcement; single-row display; external-device target/display settings;
  password rotation; register/mobile/external device creation; and contingents.
- Add direct user-number reads plus quick-dial validation, creation, updates,
  and deletion without routing these operations through phonelines.
- Add emergency-address listing, detail, number association, and updates for
  assigning verified addresses to register devices.
- Enforce every new user-scoped resource target against owned devices, owned
  numbers (including the device fallback on phoneline-less accounts), or
  addresses associated with an owned device/number. Unknown ownership fails
  closed with an access-policy error; administrator account scope retains its
  broader behavior.
- Return `{before, after}` for all mutations, with explicit no-read-back notes
  for creates and deletes. Redact credential containers and the one-time
  password returned by device password rotation.
- Expand read-only mode from seven to 47 read tools; write tools are never
  registered in read-only mode.
- Bump the package, CLI, and setup skill to version 0.5.0.

## 0.4.0 - 2026-08-30

- Treat a 403/404 from the phoneline endpoints as "feature absent" instead of a
  hard failure. Accounts without a phoneline layer keep their numbers directly
  on a device, and a single failing phoneline lookup previously took down
  `list_numbers`, `call_history`, `get_routing`, and `get_settings`.
- Resolve user numbers through the owning device when no phoneline layer
  exists, and report the fallback via `source`, `phonelinesAvailable`, and
  `numbersAvailable`.
- Scope user call history to device IDs when no phoneline IDs are available, so
  history is no longer silently empty or denied.
- Accept an owned device as a routing destination in user scope. Numbers on
  phoneline-less accounts point at a device, so the previous phoneline-only
  check rejected every legitimate destination.
- Read every page of account numbers instead of a single 1000-number page, so
  ownership checks and pagination stay correct on large accounts.
- Ask during interactive setup whether to register write tools instead of
  silently defaulting to read-only. `--allow-writes` and the new `--read-only`
  skip the question; a non-interactive run without either stays read-only.

## 0.3.1 - 2026-08-30

- Fix Claude Code registration by using its unambiguous `mcp add-json` command
  instead of the variadic `--env` parser.
- Clearly map macOS Keychain's generic `password data` prompts to sipgate's
  PAT-ID and PAT labels.
- Reuse existing Keychain credentials on repeated setup runs and add
  `--replace-credentials` for deliberate rotation.

## 0.3.0 - 2026-08-30

- Add `sipgate-mcp setup` for interactive PAT storage in macOS Keychain.
- Register installed Codex and Claude Code clients with a secret-free launch
  command, user scope, and read-only mode by default.
- Load Keychain credentials automatically when environment credentials are
  absent, while keeping environment variables as an explicit override.
- Add setup dry-run and opt-in write-mode flags.
- Add a versioned agent skill and README bootstrap link for guided setup.
- Add `sipgate-mcp --version` and verify that CLI, package, and skill versions
  remain synchronized.

## 0.2.0 - 2026-08-30

- Default to MCP-level user scope resolved from sipgate's authenticated user.
- Restrict user-scoped users, numbers, devices, phonelines, settings, and call
  history to the authenticated user's resources.
- Validate user-scoped write targets and outbound caller identities before
  sending changes or chargeable actions to sipgate.
- Avoid account-wide number and active-call snapshots in user-scoped actions.
- Add explicit account scope that requires a verified sipgate administrator.
- Advertise active scope and read-only behavior through MCP server instructions.

## 0.1.0 - 2026-08-30

- Initial local stdio MCP server with focused sipgate read and write tools.
- Personal Access Token authentication and optional read-only mode.
