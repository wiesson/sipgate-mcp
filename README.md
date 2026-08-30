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
installed supported client (Codex and Claude Code) in user/read-only mode.
Those clients start and stop the stdio server automatically; `sipgate-mcp` does
not run as a daemon and does not need to be started manually.

Use `sipgate-mcp setup --client codex` or `--client claude` to configure only
one client. Add `--allow-writes` only when agent-initiated account changes are
deliberately wanted. `--dry-run` prints the secret-free registration commands
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
| `user` (default) | Resolves the authenticated user through `/authorization/userinfo`; returns only that user and their assigned numbers; forces user-specific device, routing, and settings reads; constrains call history to owned connection IDs; and validates every write target against owned numbers, phonelines, or devices. |
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
| `list_numbers` | Read | User: `GET /{self}/phonelines` and each phoneline's `/numbers`; account: `GET /numbers` | User: `phonelines:read`, `phonelines:numbers:read`; account: `numbers:read` |
| `list_devices` | Read | User: `GET /{self}/devices`; account: `GET /users`, `GET /{userId}/devices` | `devices:read`; account also needs `users:read` when `user_id` is omitted |
| `get_routing` | Read | User: own phonelines, numbers, and forwardings; account: also `GET /numbers` and `GET /users` | `phonelines:read`, `phonelines:numbers:read`, `phonelines:forwardings:read`; account also needs `numbers:read` and, when `user_id` is omitted, `users:read` |
| `call_history` | Read | User: ownership reads for own phonelines/devices, then filtered `GET /history`; account: `GET /history` | `history:read`; user also needs `phonelines:read`, `devices:read` |
| `get_settings` | Read | `GET /users[/userId]`, `GET /{userId}/devices`, `GET /{userId}/phonelines[/phonelineId]` | `users:read`, `devices:read`, `phonelines:read` |
| `set_number_routing` | Write | User: pre/post reads through own phonelines; account: pre/post `GET /numbers`; all modes: `PUT /numbers/{numberId}` | `numbers:write`; user also needs `phonelines:read`, `phonelines:numbers:read`; account needs `numbers:read` |
| `set_forwarding` | Write | User: phoneline ownership read; then pre/post forwarding reads and `PUT` | `phonelines:read`, `phonelines:write`, `phonelines:forwardings:read`, `phonelines:forwardings:write` |
| `set_dnd` | Write | User: device ownership read; then pre/post `GET /devices/{deviceId}` and `PUT` | `devices:read`, `devices:write` |
| `send_sms` | Write/action | `GET /{userId}/sms`, pre/post `GET /history`, `POST /sessions/sms` | `sms:read`, `history:read`, `sessions:write`, `sessions:sms:write` |
| `initiate_call` | Write/action | User: device/number ownership reads, then `POST /sessions/calls`; account: pre/post `GET /calls` plus `POST` | `sessions:write`, `sessions:calls:write`; user also needs `devices:read`, `phonelines:read`, `phonelines:numbers:read`; account needs `rtcm:read` |

Every write tool reads current state first and returns a JSON object with `before` and `after`. SMS history can update asynchronously, and `/calls` only contains established calls, so those action snapshots also include an acceptance/session marker.

### Tool notes

- `list_devices` resolves devices through users because the documented account-wide route is `GET /{userId}/devices`; the live v2 Swagger document does not define `GET /devices`.
- User scope resolves assigned numbers through the authenticated user's phonelines and never calls account-wide `GET /users` or `GET /numbers` for read tools.
- User-scoped number-routing snapshots are also resolved through owned phonelines, and user-scoped Click2Dial deliberately omits account-wide `/calls` snapshots.
- Number routing uses sipgate's documented `endpointId`. Obtain existing IDs from the read tools; a phoneline ID such as `p0` is the documented example.
- `set_forwarding` replaces the complete phoneline forwarding list. Pass `forwardings: []` to remove all forwardings. A `timeout` of `0` represents immediate forwarding.
- `send_sms` refuses to post unless `GET /{userId}/sms` returns the requested (or first available) SMS extension.
- sipgate documents `POST /sessions/calls` as the classic-PBX Click2Dial route. The API documentation points Neo PBX accounts to `/calls`; supporting that distinct call workflow is left for a future compatibility pass.

## Read-only mode

Set `SIPGATE_MCP_READONLY=1` to register only the seven read tools. Write tools are absent from `tools/list`, rather than merely failing when called.

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
- User scope is the default and validates user IDs plus number, phoneline, device, call, and history ownership before delegation.
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
