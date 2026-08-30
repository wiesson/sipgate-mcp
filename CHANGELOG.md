# Changelog

## 0.5.0 - 2026-08-30

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
- Expand read-only mode from seven to 18 read tools; none of the 17 new write
  tools are registered in read-only mode.
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
