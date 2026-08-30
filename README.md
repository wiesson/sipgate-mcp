# sipgate-mcp

`sipgate-mcp` is an open-source, self-hosted Model Context Protocol server for inspecting and configuring a sipgate account. It exposes the sipgate REST API v2 as focused tools for agents such as Claude Code, Claude Desktop, and Codex.

Version 0.2 and later default to user-scoped access: tools are constrained to the
authenticated sipgate user's resources. Account-wide access is an explicit
administrator-only mode.

The server uses stdio only. It does not start an HTTP server or route credentials
through a third-party service. It sends authentication only from the local MCP
process directly to `https://api.sipgate.com/v2`.

## Agent-assisted setup

Tell Codex or Claude:

> Set up sipgate MCP by following
> https://raw.githubusercontent.com/wiesson/sipgate-mcp/main/SKILL.md

The linked, versioned [`SKILL.md`](SKILL.md) tells the agent how to install and
verify the matching package without asking for credentials in chat. Secret
entry remains an interactive local Keychain step controlled by the user.

## Requirements

- Node.js 22 or newer
- A sipgate account with a Personal Access Token (PAT)
- An MCP client with stdio support

Install the command globally with any of the supported package managers:

```bash
npm install --global sipgate-mcp
pnpm add --global sipgate-mcp
vp install --global sipgate-mcp
```

On macOS, run the interactive setup once:

```bash
sipgate-mcp setup
```

The setup stores the PAT token ID and token in macOS Keychain without placing
either value in shell history or an MCP configuration file. It registers every
installed supported client (Codex and Claude Code) in user scope. An
interactive setup asks whether to enable write tools; a non-interactive setup
without a mode flag registers read-only.
Those clients start and stop the stdio server automatically; `sipgate-mcp` does
not run as a daemon and does not need to be started manually.

Use `sipgate-mcp setup --client codex` or `--client claude` to configure only
one client. `--allow-writes` and `--read-only` pick the mode without being
asked; write tools let the assistant place calls, send SMS/faxes, and configure
routing, devices, phonelines, voicemail, greetings, recordings, and faxlines.
`--dry-run` prints the secret-free registration commands
without changing the Keychain or client configuration. Repeated setup runs
reuse existing Keychain credentials; use `--replace-credentials` only to rotate
the stored PAT-ID and PAT.

During first setup, macOS calls both secure inputs `password data`. The setup
labels the steps explicitly: enter the sipgate **PAT-ID** twice in step 1, then
the sipgate **PAT** twice in step 2. Input remains hidden while typing.

Secure interactive storage currently supports macOS. Environment variables
remain available for Linux, Windows, containers, CI, and password-manager
wrappers. To avoid putting literal credentials in shell history, read them
interactively:

```bash
printf "sipgate PAT token ID: "
IFS= read -r SIPGATE_TOKEN_ID
printf "sipgate PAT token: "
IFS= read -rs SIPGATE_TOKEN
printf "\n"
export SIPGATE_TOKEN_ID SIPGATE_TOKEN
export SIPGATE_MCP_SCOPE="user"
export SIPGATE_MCP_READONLY="1"
```

For clients that manage MCP commands on demand, `npx -y sipgate-mcp` remains
supported without a global installation.

## Create a Personal Access Token

1. Open [sipgate Personal Access Tokens](https://app.sipgate.com/personal-access-token).
2. Select **Add token**, give the token a recognizable name, and select the scopes needed for the tools you intend to use.
3. Copy both the token ID and token. sipgate displays the token itself only once.
4. Run `sipgate-mcp setup` on macOS, or provide them as `SIPGATE_TOKEN_ID` and `SIPGATE_TOKEN` in the MCP process environment.

sipgate PAT authentication uses HTTP Basic Auth with `token-id:token` as the credential pair. `sipgate-mcp` constructs that header in memory. See sipgate's [authentication guide](https://en.sipgate.io/rest-api/authentication).

Do not put either value in this repository, an MCP config committed to source control, shell command arguments, command output, or an issue report.

The separate **API Clients** screen in the sipgate account creates OAuth 2.0
client credentials for an application that redirects users through sipgate's
authorization flow. Those client credentials are not PAT replacements and are
not used by the local stdio setup. They are relevant to a future hosted/remote
MCP, which would need a registered redirect URI, user consent, access-token
refresh, and secure per-user token storage. See sipgate's [OAuth authentication
flow](https://en.sipgate.io/rest-api/authentication#oauth2) and [API client
management](https://en.sipgate.io/rest-api/managing-third-party-clients).

## MCP access scopes

`SIPGATE_MCP_SCOPE` controls the resource boundary enforced by the MCP in
addition to sipgate's own user role and PAT scopes:

| Value | Behavior |
| --- | --- |
| `user` (default) | Resolves the authenticated user through `/authorization/userinfo`; returns only that user and their assigned numbers, notifications, faxlines, phonelines, voicemails, greetings, and attached devices; forces user-specific device, routing, and settings reads; constrains history and active calls to owned connections/participants; and validates every write target against owned numbers, phonelines, nested voicemail/forwarding/greeting resources, devices, faxlines, notifications, or emergency addresses associated with an owned device/number. |
| `account` | Enables account-wide reads and writes. Startup fails unless `/users/{authenticatedUserId}` reports `admin: true`. Requires `users:read` for the administrator check. |

Token scopes are permission ceilings, not role elevation. For example,
`numbers:write` does not turn a regular sipgate user into an administrator.
The effective permission is the intersection of the sipgate user role, PAT
scopes, MCP access scope, and read-only mode.

Use account scope only when account-wide administration is intended:

```bash
export SIPGATE_MCP_SCOPE="account"
npx -y sipgate-mcp
```

## Tools and PAT scopes

Every mode identifies the authenticated user with `GET /authorization/userinfo`.
The table lists the non-`all` scopes named by sipgate's live Swagger document,
including ownership checks performed in user scope and pre/post state reads.
sipgate also exposes broader parent scopes such as `sessions:write`; select the
listed specific and parent scopes offered by the PAT UI when in doubt.

| Tool | Access | sipgate API calls | PAT scopes |
| --- | --- | --- | --- |
| `account_info` | Read | User: cached `/authorization/userinfo`; account: plus `GET /account` | Account: `account:read` (`userinfo` has no scope declaration in Swagger) |
| `list_users` | Read | User: `GET /users/{self}`; account: `GET /users` | `users:read` |
| `list_numbers` | Read | User: own phonelines, or owned devices plus paginated `GET /numbers` when phonelines are unavailable; account: `GET /numbers` | User: `phonelines:read`, `phonelines:numbers:read`; fallback: `devices:read`, `numbers:read`; account: `numbers:read` |
| `list_devices` | Read | User: `GET /{self}/devices`; account: `GET /users`, `GET /{userId}/devices` | `devices:read`; account also needs `users:read` when `user_id` is omitted |
| `get_device` | Read | Ownership `GET /{self}/devices`, then `GET /devices/{deviceId}` | `devices:read` |
| `get_device_caller_id` | Read | Device ownership read, then `GET /devices/{deviceId}/callerid` | `devices:read`, `devices:callerid:read` |
| `get_device_local_prefix` | Read | Device ownership read, then `GET /devices/{deviceId}/localprefix` | `devices:read`, `devices:localprefix:read` |
| `get_device_tariff_announcement` | Read | Device ownership read, then `GET /devices/{deviceId}/tariffannouncement` | `devices:read`, `devices:tariffannouncement:read` |
| `get_device_single_row_display` | Read | Device ownership read, then `GET /devices/{deviceId}/singlerowdisplay` | `devices:read`, `devices:singlerowdisplay:read` |
| `get_device_contingents` | Read | Device/user ownership reads, then `GET /{userId}/devices/{deviceId}/contingents` | `devices:read` |
| `list_user_numbers` | Read | `GET /{userId}/numbers`; this direct endpoint never uses phonelines | `numbers:read` |
| `validate_quick_dial` | Read | `GET /numbers/quickdial/validation/{quickDialNumber}` | `numbers:read` |
| `list_addresses` | Read | `GET /addresses`; user scope filters through owned device/number relationships | `addresses:read`; user ownership also needs `devices:read`, `numbers:read` and the applicable owned-number read scopes |
| `get_address` | Read | Address ownership reads, then `GET /addresses/{addressId}` | `addresses:read`; user ownership also needs `devices:read`, `numbers:read` and the applicable owned-number read scopes |
| `list_address_numbers` | Read | Address ownership reads, then `GET /addresses/{addressId}/numbers` | `numbers:read`, plus user ownership read scopes |
| `get_routing` | Read | User: own phonelines, numbers, and forwardings; account: also `GET /numbers` and `GET /users` | `phonelines:read`, `phonelines:numbers:read`, `phonelines:forwardings:read`; account also needs `numbers:read` and, when `user_id` is omitted, `users:read` |
| `call_history` | Read | User: ownership reads for own phonelines/devices, then filtered `GET /history`; account: `GET /history` | `history:read`; user also needs `phonelines:read`, `devices:read` |
| `list_calls` | Read | `GET /calls`; user scope filters calls to participants matching an owned device ID or phone number | `rtcm:read`; user ownership also needs `devices:read`, `numbers:read` and applicable owned-number scopes |
| `list_notifications` | Read | `GET /{userId}/notifications` | `notifications:read` |
| `list_faxlines` | Read | `GET /{userId}/faxlines` | `faxlines:read` |
| `list_faxline_numbers` | Read | User: faxline ownership read, then `GET /{userId}/faxlines/{faxlineId}/numbers`; account: direct `GET` | `faxlines:read`, `faxlines:numbers:read` |
| `get_phoneline` | Read | Owned-phoneline lookup, then `GET /{userId}/phonelines/{phonelineId}` | `phonelines:read` |
| `get_phoneline_block_anonymous` | Read | Owned-phoneline lookup, then `GET /{userId}/phonelines/{phonelineId}/blockanonymous` | `phonelines:read`, `phonelines:blockanonymous:read` |
| `list_phoneline_devices` | Read | Owned-phoneline/device filtering, then `GET /{userId}/phonelines/{phonelineId}/devices` | `phonelines:read`, `phonelines:devices:read`; user filtering also needs `devices:read` |
| `list_parallel_forwardings` | Read | Owned-phoneline lookup, then `GET /{userId}/phonelines/{phonelineId}/parallelforwardings` | `phonelines:read`, `phonelines:parallelforwardings:read` |
| `list_phoneline_voicemails` | Read | Owned-phoneline lookup, then `GET /{userId}/phonelines/{phonelineId}/voicemails` | `phonelines:read`, `phonelines:voicemails:read` |
| `list_voicemail_greetings` | Read | Owned phoneline/voicemail lookup, then `GET /{userId}/phonelines/{phonelineId}/voicemails/{voicemailId}/greetings` | `phonelines:read`, `phonelines:voicemails:read`, `phonelines:voicemails:greetings:read` |
| `list_voicemails` | Read | `GET /voicemails`; user scope filters by voicemail IDs discovered under owned phonelines | `voicemails:read`; user filtering also needs `phonelines:read`, `phonelines:voicemails:read` |
| `get_voicemail` | Read | Owned-voicemail lookup, then `GET /voicemails/{voicemailId}` | `voicemails:read`; user ownership also needs `phonelines:read`, `phonelines:voicemails:read` |
| `list_autorecording_greetings` | Read | `GET /autorecordings/greetings` | `autorecording:greeting:read`; sipgate also requires administrator privileges and activated call recording |
| `get_autorecording_settings` | Read | Owned phoneline/faxline extension lookup, then `GET /autorecordings/{extension}/settings` | `devices:read`; ownership also needs `phonelines:read`, `faxlines:read` |
| `get_faxline_caller_id` | Read | Owned-faxline lookup, then `GET /{userId}/faxlines/{faxlineId}/callerid` | `faxlines:read` |
| `create_phoneline` | Write/action | `POST /{userId}/phonelines`; 403/404 becomes a clean unavailable result | `phonelines:write` |
| `update_phoneline_alias` | Write | Owned-phoneline before/after reads and `PUT /{userId}/phonelines/{phonelineId}` | `phonelines:read`, `phonelines:write` |
| `delete_phoneline` | Write | Owned-phoneline before-state read and `DELETE /{userId}/phonelines/{phonelineId}` | `phonelines:read`, `phonelines:write` |
| `set_phoneline_block_anonymous` | Write | Owned-phoneline setting reads and `PUT /{userId}/phonelines/{phonelineId}/blockanonymous` | `phonelines:read`, `phonelines:blockanonymous:read`, `phonelines:blockanonymous:write` |
| `attach_device_to_phoneline` | Write/action | Owned phoneline/device reads, pre/post assignment reads, and `POST /{userId}/phonelines/{phonelineId}/devices` | `phonelines:read`, `phonelines:devices:read`, `phonelines:devices:write`, `devices:read` |
| `detach_device_from_phoneline` | Write | Owned phoneline/device reads, pre/post assignment reads, and `DELETE /{userId}/phonelines/{phonelineId}/devices/{deviceId}` | `phonelines:read`, `phonelines:devices:read`, `phonelines:devices:write`, `devices:read` |
| `create_parallel_forwarding` | Write/action | Owned-phoneline check, pre/post forwarding reads, and `POST /{userId}/phonelines/{phonelineId}/parallelforwardings` | `phonelines:read`, `phonelines:write`, `phonelines:parallelforwardings:read`, `phonelines:parallelforwardings:write` |
| `update_parallel_forwarding` | Write | Verify forwarding in the owned phoneline, pre/post reads, and `PUT /{userId}/phonelines/{phonelineId}/parallelforwardings/{parallelForwardingId}` | `phonelines:read`, `phonelines:write`, `phonelines:parallelforwardings:read`, `phonelines:parallelforwardings:write` |
| `delete_parallel_forwarding` | Write | Verify forwarding in the owned phoneline, pre/post reads, and `DELETE /{userId}/phonelines/{phonelineId}/parallelforwardings/{parallelForwardingId}` | `phonelines:read`, `phonelines:write`, `phonelines:parallelforwardings:read`, `phonelines:parallelforwardings:write` |
| `update_voicemail` | Write | Verify voicemail in the owned phoneline, pre/post voicemail reads, and `PUT /{userId}/phonelines/{phonelineId}/voicemails/{voicemailId}` | `phonelines:read`, `phonelines:write`, `phonelines:voicemails:read`, `phonelines:voicemails:write` |
| `create_voicemail_greeting` | Write/action | Verify owned voicemail, pre/post greeting reads, and `POST /{userId}/phonelines/{phonelineId}/voicemails/{voicemailId}/greetings` | `phonelines:read`, `phonelines:write`, `phonelines:voicemails:read`, `phonelines:voicemails:write`, `phonelines:voicemails:greetings:read`, `phonelines:voicemails:greetings:write` |
| `update_voicemail_greeting` | Write | Verify greeting under the owned voicemail, pre/post reads, and `PUT /{userId}/phonelines/{phonelineId}/voicemails/{voicemailId}/greetings/{greetingId}` | Same phoneline/voicemail/greeting read/write scopes as greeting creation |
| `delete_voicemail_greeting` | Write | Verify greeting under the owned voicemail, pre/post reads, and `DELETE /{userId}/phonelines/{phonelineId}/voicemails/{voicemailId}/greetings/{greetingId}` | Same phoneline/voicemail/greeting read/write scopes as greeting creation |
| `set_voicemail_transcription` | Write | Verify owned voicemail, pre/post voicemail reads, and `PUT /{userId}/phonelines/{phonelineId}/voicemails/{voicemailId}/transcriptions` | `phonelines:read`, `phonelines:write`, `phonelines:voicemails:read`, `phonelines:voicemails:write` |
| `play_voicemail` | Write/action | User: verify owned device and history/data entry; then `POST /sessions/voicemail/play` | `sessions:write`, `sessions:calls:write`; user ownership also needs `devices:read`, `history:read` and owned-connection scopes |
| `record_voicemail_greeting` | Write/action | User: verify owned device and target voicemail; then `POST /sessions/voicemail/recording` | `sessions:write`, `sessions:calls:write`; user ownership also needs `devices:read`, `phonelines:read`, `phonelines:voicemails:read` |
| `create_autorecording_greeting` | Write/action | Pre/post `GET /autorecordings/greetings`, `POST /autorecordings/greetings` | `autorecording:greeting:read`, `autorecording:greeting:write`; sipgate requires administrator privileges and activated call recording |
| `delete_autorecording_greeting` | Write | Verify current greeting ID, then `DELETE /autorecordings/greetings/{greetingId}` | `autorecording:greeting:read`, `autorecording:greeting:write`; sipgate requires administrator privileges and activated call recording |
| `set_autorecording_settings` | Write | Owned phoneline/faxline extension lookup, pre/post setting reads, and `PUT /autorecordings/{extension}/settings` | `devices:read`; ownership also needs `phonelines:read`, `faxlines:read` |
| `create_faxline` | Write/action | `POST /{userId}/faxlines` | `faxlines:write` |
| `update_faxline_alias` | Write | Owned-faxline pre/post list reads and `PUT /{userId}/faxlines/{faxlineId}` | `faxlines:read`, `faxlines:write` |
| `delete_faxline` | Write | Owned-faxline before-state read and `DELETE /{userId}/faxlines/{faxlineId}` | `faxlines:read`, `faxlines:write` |
| `set_faxline_caller_id` | Write | Owned faxline/number checks, pre/post caller-ID reads, and `PUT /{userId}/faxlines/{faxlineId}/callerid` | `faxlines:read`, `faxlines:write`, plus owned-number read scopes |
| `set_faxline_tagline` | Write | Owned-faxline pre/post list reads and `PUT /{userId}/faxlines/{faxlineId}/tagline` | `faxlines:read`, `faxlines:write` |
| `get_settings` | Read | `GET /users[/userId]`, `GET /{userId}/devices`, `GET /{userId}/phonelines[/phonelineId]` | `users:read`, `devices:read`, `phonelines:read` |
| `set_number_routing` | Write | User: pre/post reads through own phonelines; account: pre/post `GET /numbers`; all modes: `PUT /numbers/{numberId}` | `numbers:write`; user also needs `phonelines:read`, `phonelines:numbers:read`; account needs `numbers:read` |
| `set_forwarding` | Write | User: phoneline ownership read; then pre/post forwarding reads and `PUT` | `phonelines:read`, `phonelines:write`, `phonelines:forwardings:read`, `phonelines:forwardings:write` |
| `set_dnd` | Write | User: device ownership read; then pre/post `GET /devices/{deviceId}` and `PUT` | `devices:read`, `devices:write` |
| `update_device` | Write | Device and optional emergency-address ownership reads; pre/post `GET` plus `PUT /devices/{deviceId}` | `devices:read`, `devices:write`; address ownership may also need `numbers:read` and owned-number read scopes |
| `delete_device` | Write | Device ownership and before-state reads, then `DELETE /devices/{deviceId}` | `devices:read`, `devices:write` |
| `set_device_alias` | Write | Device ownership read; pre/post device reads and `PUT /devices/{deviceId}/alias` | `devices:read`, `devices:write` |
| `set_device_caller_id` | Write | Device and caller-number ownership reads; pre/post caller-ID reads and `PUT /devices/{deviceId}/callerid` | `devices:read`, `devices:write`, `devices:callerid:read`, `devices:callerid:write`, plus owned-number read scopes |
| `set_device_local_prefix` | Write | Device ownership read; pre/post setting reads and `PUT /devices/{deviceId}/localprefix` | `devices:read`, `devices:write`, `devices:localprefix:read`, `devices:localprefix:write` |
| `set_device_tariff_announcement` | Write | Device ownership read; pre/post setting reads and `PUT /devices/{deviceId}/tariffannouncement` | `devices:read`, `devices:write`, `devices:tariffannouncement:read`, `devices:tariffannouncement:write` |
| `set_device_single_row_display` | Write | Device ownership read; pre/post setting reads and `PUT /devices/{deviceId}/singlerowdisplay` | `devices:read`, `devices:write`, `devices:singlerowdisplay:read`, `devices:singlerowdisplay:write` |
| `set_external_device_target_number` | Write | Device ownership read; pre/post device reads and `PUT /devices/{deviceId}/external/targetnumber` | `devices:read`, `devices:write` |
| `set_external_device_incoming_call_display` | Write | Device ownership read; pre/post device reads and `PUT /devices/{deviceId}/external/incomingcalldisplay` | `devices:read`, `devices:write` |
| `change_device_password` | Write/action | Device ownership/before-state reads, then `POST /devices/{deviceId}/credentials/password`; the response is redacted | `devices:read`, `devices:write` |
| `create_register_device` | Write/action | `POST /{userId}/devices/register` | `devices:write` |
| `create_mobile_device` | Write/action | `POST /{userId}/devices/mobile` | `devices:write` |
| `create_external_device` | Write/action | `POST /{userId}/devices/external` | `devices:write` |
| `create_quick_dial` | Write/action | `POST /numbers/quickdial` | `numbers:write` |
| `update_quick_dial` | Write | Owned-number before/after reads and `PUT /numbers/quickdial/{quickdialId}` | `numbers:read`, `numbers:write`, plus applicable owned-number read scopes |
| `delete_quick_dial` | Write | Owned-number before-state read and `DELETE /numbers/quickdial/{numberId}` | `numbers:read`, `numbers:write`, plus applicable owned-number read scopes |
| `update_address` | Write | Address ownership and pre/post address reads, then `PUT /addresses/{addressId}` | `addresses:read`, `addresses:write`, plus user ownership read scopes |
| `send_sms` | Write/action | `GET /{userId}/sms`, pre/post `GET /history`, `POST /sessions/sms` | `sms:read`, `history:read`, `sessions:write`, `sessions:sms:write` |
| `initiate_call` | Write/action | User: device/number ownership reads, then `POST /sessions/calls`; account: pre/post `GET /calls` plus `POST` | `sessions:write`, `sessions:calls:write`; user also needs `devices:read`, `phonelines:read`, `phonelines:numbers:read`; account needs `rtcm:read` |
| `create_call_email_notification` | Write/action | User: endpoint ownership reads; all modes: pre/post `GET /{userId}/notifications`, `POST /{userId}/notifications/call/email` | `notifications:read`, `notifications:write`; user also needs `devices:read` or `phonelines:read` |
| `create_call_sms_notification` | Write/action | User: endpoint ownership reads; all modes: pre/post notification reads, `POST /{userId}/notifications/call/sms` | `notifications:read`, `notifications:write`; user also needs `devices:read` or `phonelines:read` |
| `create_fax_email_notification` | Write/action | User: faxline ownership read; all modes: pre/post notification reads, `POST /{userId}/notifications/fax/email` | `notifications:read`, `notifications:write`; user also needs `faxlines:read` |
| `create_fax_sms_notification` | Write/action | User: faxline ownership read; all modes: pre/post notification reads, `POST /{userId}/notifications/fax/sms` | `notifications:read`, `notifications:write`; user also needs `faxlines:read` |
| `create_fax_report_notification` | Write/action | User: faxline ownership read; all modes: pre/post notification reads, `POST /{userId}/notifications/fax/report` | `notifications:read`, `notifications:write`; user also needs `faxlines:read` |
| `create_sms_email_notification` | Write/action | Pre/post notification reads, `POST /{userId}/notifications/sms/email` | `notifications:read`, `notifications:write` |
| `create_voicemail_email_notification` | Write/action | Pre/post notification reads, `POST /{userId}/notifications/voicemail/email` | `notifications:read`, `notifications:write` |
| `create_voicemail_sms_notification` | Write/action | Pre/post notification reads, `POST /{userId}/notifications/voicemail/sms` | `notifications:read`, `notifications:write` |
| `delete_notification` | Write | User: verify the nested ID in `GET /{userId}/notifications`; all modes: before/after notification reads and `DELETE /{userId}/notifications/{notificationId}` | `notifications:read`, `notifications:write` |
| `hangup_call` | Write | User: participant ownership read; all modes: before/after `GET /calls`, `DELETE /calls/{callId}` | `rtcm:read`, `rtcm:write`; user also needs owned-device/number read scopes |
| `set_call_hold` | Write | User: participant ownership read; before/after `GET /calls`, `PUT /calls/{callId}/hold` | `rtcm:read`, `rtcm:write`; user also needs owned-device/number read scopes |
| `set_call_muted` | Write | User: participant ownership read; before/after `GET /calls`, `PUT /calls/{callId}/muted` | `rtcm:read`, `rtcm:write`; user also needs owned-device/number read scopes |
| `set_call_recording` | Write | User: participant ownership read; before/after `GET /calls`, `PUT /calls/{callId}/recording` | `rtcm:read`, `rtcm:write`; user also needs owned-device/number read scopes |
| `transfer_call` | Write/action | User: call-participant and optional caller-ID ownership reads; before/after `GET /calls`, `POST /calls/{callId}/transfer` | `rtcm:read`, `rtcm:write`; user also needs owned-device/number read scopes |
| `send_call_dtmf` | Write/action | User: participant ownership read; before/after `GET /calls`, `POST /calls/{callId}/dtmf` | `rtcm:read`, `rtcm:write`; user also needs owned-device/number read scopes |
| `start_call_announcement` | Write/action | User: participant ownership read; before/after `GET /calls`, `POST /calls/{callId}/announcements` | `rtcm:read`, `rtcm:write`; user also needs owned-device/number read scopes |
| `send_fax` | Write/action | User: faxline ownership read; `POST /sessions/fax` | `sessions:write`, `sessions:fax:write`; user also needs `faxlines:read` |
| `resend_fax` | Write/action | User: required faxline ownership read; `POST /sessions/fax/resend` | `sessions:write`, `sessions:fax:write`; user also needs `faxlines:read` |

Every write tool returns a JSON object with `before` and `after`. Where a resource can be read, the tool reads current state first and reads it back after the change. Fax send/resend and voicemail playback/recording sessions use `before: null` and return an explicit no-read-back note; creates without a previous resource and deletes without a documented read-back return an initial-state or deletion marker. SMS history can update asynchronously, and `/calls` only contains established calls.

### Tool notes

- `list_devices` resolves devices through users because the documented account-wide route is `GET /{userId}/devices`; the live v2 Swagger document does not define `GET /devices`.
- `list_user_numbers` calls the documented direct `GET /{userId}/numbers` endpoint and never uses phonelines. Ownership checks retain the device-based fallback required by accounts without a phoneline layer.
- Every phoneline-dependent tool treats sipgate HTTP 403/404 as feature absence. On accounts where numbers hang directly from a device, reads return `phonelinesAvailable: false` and writes return `changed: false` without attempting the mutation. An available but empty phoneline list still denies every supplied phoneline ID.
- User scope establishes nested ownership from the documented collections: parallel forwardings under an owned phoneline, voicemails under an owned phoneline, greetings under an owned voicemail, and attached devices that are independently owned. Global `/voicemails` results are filtered to those discovered IDs.
- Voicemail playback requires an owned device and an owned history/data entry in user scope. The live Swagger request field is spelled `datadId`; the MCP exposes the clearer `data_id` and maps it without changing the API payload. Voicemail greeting recording requires an owned device and target voicemail in user scope.
- Automated recording settings accept only an extension found in the authenticated user's phonelines or faxlines. The current automated-recording greeting is an account-level sipgate resource whose API additionally requires administrator privileges and activated call recording.
- User scope never calls account-wide `GET /users`. It calls paginated account `GET /numbers` only for the device-based ownership fallback when phonelines are unavailable.
- User-scoped number-routing snapshots are also resolved through owned phonelines, and user-scoped Click2Dial deliberately omits account-wide `/calls` snapshots.
- User-scoped `list_calls` and every live-call mutation read the account-wide `/calls` feed but expose or operate on a call only when at least one participant's `participantId` matches an owned device or `phoneNumber` matches an owned phone number. A missing, unknown, or unreadable match fails closed. sipgate's Swagger does not expose a separate call-owner user or device field.
- Notification IDs live inside the nested email/SMS/report target arrays returned by `GET /{userId}/notifications`; deletion verifies that nested ID before sending the request. Call-notification endpoints are checked against owned devices/phonelines, and fax notifications against owned faxlines.
- Fax send and resend actions incur charges. In user scope `resend_fax` requires `faxline_id` even though sipgate marks it optional, because omitting it leaves no documented ownership relationship that can be verified before the chargeable action.
- Call and automated recording can incur charges and are legally sensitive. In Germany the caller is responsible for obtaining consent from every participant; changing or disabling an announcement does not remove that responsibility. Voicemail playback/recording initiates a call and may also incur charges.
- Address IDs are exposed as integers because sipgate declares every address path parameter as `int32`. In user scope an address is visible or mutable only when an owned device references it, an owned number contains its `addressId`, or `/addresses/{addressId}/numbers` contains an owned number.
- Device creation can affect billing, and changing an address can deactivate associated telephone numbers depending on country. Every write-tool description advertises the account change and potential charges.
- Device password rotation intentionally redacts the complete credential container, including sipgate's one-time password response.
- Number routing uses sipgate's documented `endpointId`. Obtain existing IDs from the read tools; a phoneline ID such as `p0` is the documented example.
- `set_forwarding` replaces the complete phoneline forwarding list. Pass `forwardings: []` to remove all forwardings. A `timeout` of `0` represents immediate forwarding.
- `send_sms` refuses to post unless `GET /{userId}/sms` returns the requested (or first available) SMS extension.
- sipgate documents `POST /sessions/calls` as the classic-PBX Click2Dial route. Live established-call reads and controls use `/calls`; starting a new Neo PBX call through the separate `POST /calls` shape is outside this batch.

## Read-only mode

Set `SIPGATE_MCP_READONLY=1` to register only the 33 read tools. Write tools are absent from `tools/list`, rather than merely failing when called.

```bash
export SIPGATE_MCP_READONLY=1
export SIPGATE_MCP_SCOPE=user
npx -y sipgate-mcp
```

## MCP client configuration

The recommended macOS path is `sipgate-mcp setup`. The following manual
examples are useful for other platforms and custom launchers. Set
`SIPGATE_TOKEN_ID` and `SIPGATE_TOKEN` in the environment that launches the MCP
client; the examples keep secret values out of configuration files.

### Claude Code

Claude Code expands `${VAR}` references in MCP environment entries. Single quotes below prevent your shell from replacing the references before Claude stores them:

```bash
claude mcp add \
  --env 'SIPGATE_TOKEN_ID=${SIPGATE_TOKEN_ID}' \
  --env 'SIPGATE_TOKEN=${SIPGATE_TOKEN}' \
  --env SIPGATE_MCP_SCOPE=user \
  --transport stdio \
  --scope user \
  sipgate -- npx -y sipgate-mcp
```

Add `--env SIPGATE_MCP_READONLY=1` before `--transport` for read-only mode. Replace the scope with `account` only for deliberate administrator access. Verify the connection with `claude mcp get sipgate`. See the official [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp).

### Claude Desktop

Ensure the Claude Desktop process inherits `SIPGATE_TOKEN_ID` and `SIPGATE_TOKEN`, then add this entry to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sipgate": {
      "command": "npx",
      "args": ["-y", "sipgate-mcp"]
    }
  }
}
```

Restart Claude Desktop after editing the file. Do not paste PAT values into the JSON. If the app was launched from a desktop shell rather than a terminal, configure the variables in that app's launch environment first.

### Codex

Codex can forward named variables from its local environment without storing their values. Add this to `~/.codex/config.toml` (or a trusted project's `.codex/config.toml`):

```toml
[mcp_servers.sipgate]
command = "npx"
args = ["-y", "sipgate-mcp"]
env_vars = ["SIPGATE_TOKEN_ID", "SIPGATE_TOKEN", "SIPGATE_MCP_SCOPE", "SIPGATE_MCP_READONLY"]
```

Export the variables before starting Codex, then use `/mcp` or `codex mcp list` to confirm the server. The `env_vars` forwarding form is documented in the [official OpenAI MCP documentation](https://developers.openai.com/codex/mcp/).

## Manual smoke test with MCP Inspector

This test makes real sipgate API calls. Start in user/read-only mode with a PAT
containing `phonelines:read` and `phonelines:numbers:read`, plus the required
environment variables:

```bash
export SIPGATE_TOKEN_ID="your-token-id"
export SIPGATE_TOKEN="your-token"
export SIPGATE_MCP_SCOPE="user"
export SIPGATE_MCP_READONLY=1
npx @modelcontextprotocol/inspector npx -y sipgate-mcp
```

The current Inspector v2 may require a more recent Node 22 minor release than the server itself. In the Inspector web UI:

1. Connect to the stdio server.
2. Open **Tools** and run `account_info` with `{}`.
3. Run `list_numbers` with `{"offset": 0, "limit": 100}`.
4. Confirm that the responses contain account/user metadata and numbers with `endpointId` assignments, and that no token or Authorization header is displayed.

The Inspector's ad-hoc stdio syntax is documented in its [server configuration guide](https://github.com/modelcontextprotocol/inspector/blob/main/docs/mcp-server-configuration.md).

## Architecture

The MCP layer depends only on the backend interface:

```text
MCP stdio server
  -> validated tool definitions (Zod)
    -> user/account access policy
      -> TelephonyBackend
        -> SipgateBackend
          -> SipgateClient
            -> native fetch -> https://api.sipgate.com/v2
```

`TelephonyBackend` contains the stable, provider-neutral operations. `SipgateBackend` is the only v1 implementation, so a future second telephony provider can reuse the same MCP tool surface.

## Security

- PAT values are read from `SIPGATE_TOKEN_ID` and `SIPGATE_TOKEN`, or from the
  current user's macOS Keychain when both variables are absent.
- `sipgate-mcp setup` delegates secret entry directly to the macOS Keychain
  prompt. Secret values are never passed as command-line arguments and are not
  written to Codex or Claude configuration.
- User scope is the default and validates user IDs plus number, phoneline,
  nested voicemail/greeting/forwarding, device, faxline, call, recording-
  extension, and history ownership before delegation.
- Account scope fails startup unless the authenticated sipgate user reports `admin: true`.
- The Basic Auth header exists only in memory and is sent only to the fixed sipgate API base URL.
- API error bodies are discarded. User-facing errors never include request headers, response bodies, or credentials.
- Potentially sensitive response properties such as `credentials`, `password`, `token`, and `secret` are redacted before tool output.
- The server writes no application logs to stdout; stdout is reserved for MCP stdio frames.
- `.env*`, fetched research data, build output, and package tarballs are ignored by Git.
- Write tools clearly identify account changes and possible charges in their descriptions. Prefer read-only mode until write access is needed.

## Development

```bash
npm install
npm run build
npm test
```

Tests use `node:test` and mocked `fetch`; they never call the real sipgate API. The suite includes client authentication/error behavior, user/account access-policy enforcement, exact critical write payloads, credential redaction, one test per MCP tool, and read-only registration.

## Releases

Normal CI tests Node.js 22 and 24. Publishing a GitHub Release whose tag matches
the version in `package.json` triggers an npm publish from a GitHub-hosted runner.
The release workflow uses npm Trusted Publishing with OpenID Connect, contains
no long-lived npm token, and produces npm provenance automatically. Stable
GitHub Releases publish under npm's `latest` tag; GitHub prereleases use `next`.

Maintainer setup and the one-time first-publish procedure are documented in
[RELEASING.md](RELEASING.md).

## API provenance and limitations

The endpoint paths, query parameters, request bodies, response models, and scope names were checked against sipgate's live public [REST API v2 Swagger document](https://api.sipgate.com/v2/swagger.json) and [Swagger UI](https://api.sipgate.com/v2/doc) on 2026-08-29. PAT Basic Auth was checked against sipgate's public authentication guide. No authenticated production account was available during development, so real-account behavior remains to be confirmed with the smoke test above—especially product-specific availability, eventual history updates, and classic versus Neo PBX calling.

## Roadmap

- v0.1: local self-hosted stdio server and sipgate REST API tools
- v0.2: user-scoped access by default plus explicit administrator-only account scope
- Future: optional remote deployment, including a Cloudflare Workers backend, without changing the MCP tool surface
- Additional `TelephonyBackend` implementation(s)
- Product-aware Click2Dial behavior for classic and Neo PBX accounts

## License

MIT © 2026 Arne Wiese. See [LICENSE](LICENSE).
