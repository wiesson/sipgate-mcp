# Changelog

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
