# sipgate-mcp

`sipgate-mcp` is an open-source, self-hosted Model Context Protocol server for inspecting and configuring a sipgate account. It exposes the sipgate REST API v2 as focused tools for agents such as Claude Code, Claude Desktop, and Codex.

The server uses stdio only. It does not start an HTTP server or route credentials
through a third-party service. It sends authentication only from the local MCP
process directly to `https://api.sipgate.com/v2`.

## Requirements

- Node.js 22 or newer
- A sipgate account with a Personal Access Token (PAT)
- An MCP client with stdio support

After the first npm release, install the command globally with any of the
supported package managers:

```bash
npm install --global sipgate-mcp
pnpm add --global sipgate-mcp
vp install --global sipgate-mcp
```

Then start it with:

```bash
export SIPGATE_TOKEN_ID="your-token-id"
export SIPGATE_TOKEN="your-token"
sipgate-mcp
```

For clients that manage MCP commands on demand, `npx -y sipgate-mcp` remains
supported without a global installation. The package name was available when
checked on 2026-08-30; this repository is configured for `sipgate-mcp`, but the
initial npm publish still needs to be completed.

## Create a Personal Access Token

1. Open [sipgate Personal Access Tokens](https://app.sipgate.com/personal-access-token).
2. Select **Add token**, give the token a recognizable name, and select the scopes needed for the tools you intend to use.
3. Copy both the token ID and token. sipgate displays the token itself only once.
4. Put them in the environment as `SIPGATE_TOKEN_ID` and `SIPGATE_TOKEN` before starting your MCP client.

sipgate PAT authentication uses HTTP Basic Auth with `token-id:token` as the credential pair. `sipgate-mcp` constructs that header in memory. See sipgate's [authentication guide](https://en.sipgate.io/rest-api/authentication).

Do not put either value in this repository, an MCP config committed to source control, command output, or an issue report.

## Tools and PAT scopes

The table lists the non-`all` scopes named by sipgate's live Swagger document, plus scopes required by this server's pre/post state reads. sipgate also exposes broader parent scopes such as `sessions:write`; select the listed specific and parent scopes offered by the PAT UI when in doubt.

| Tool | Access | sipgate API calls | PAT scopes |
| --- | --- | --- | --- |
| `account_info` | Read | `GET /account`, `GET /authorization/userinfo` | `account:read` (`userinfo` has no scope declaration in Swagger) |
| `list_users` | Read | `GET /users` | `users:read` |
| `list_numbers` | Read | `GET /numbers` | `numbers:read` |
| `list_devices` | Read | `GET /users`, `GET /{userId}/devices` | `devices:read`; `users:read` when `user_id` is omitted |
| `get_routing` | Read | `GET /numbers`, `GET /users`, `GET /{userId}/phonelines`, `GET /{userId}/phonelines/{phonelineId}/numbers`, `GET /{userId}/phonelines/{phonelineId}/forwardings` | `numbers:read`, `phonelines:read`, `phonelines:numbers:read`, `phonelines:forwardings:read`; `users:read` when `user_id` is omitted |
| `call_history` | Read | `GET /history` | `history:read` |
| `get_settings` | Read | `GET /users[/userId]`, `GET /{userId}/devices`, `GET /{userId}/phonelines[/phonelineId]` | `users:read`, `devices:read`, `phonelines:read` |
| `set_number_routing` | Write | pre/post `GET /numbers`, `PUT /numbers/{numberId}` | `numbers:read`, `numbers:write` |
| `set_forwarding` | Write | pre/post `GET /{userId}/phonelines/{phonelineId}/forwardings`, `PUT` to the same path | `phonelines:read`, `phonelines:write`, `phonelines:forwardings:read`, `phonelines:forwardings:write` |
| `set_dnd` | Write | pre/post `GET /devices/{deviceId}`, `PUT /devices/{deviceId}` | `devices:read`, `devices:write` |
| `send_sms` | Write/action | `GET /{userId}/sms`, pre/post `GET /history`, `POST /sessions/sms` | `sms:read`, `history:read`, `sessions:write`, `sessions:sms:write` |
| `initiate_call` | Write/action | pre/post `GET /calls`, `POST /sessions/calls` | `rtcm:read`, `sessions:write`, `sessions:calls:write` |

Every write tool reads current state first and returns a JSON object with `before` and `after`. SMS history can update asynchronously, and `/calls` only contains established calls, so those action snapshots also include an acceptance/session marker.

### Tool notes

- `list_devices` resolves devices through users because the documented account-wide route is `GET /{userId}/devices`; the live v2 Swagger document does not define `GET /devices`.
- Number routing uses sipgate's documented `endpointId`. Obtain existing IDs from the read tools; a phoneline ID such as `p0` is the documented example.
- `set_forwarding` replaces the complete phoneline forwarding list. Pass `forwardings: []` to remove all forwardings. A `timeout` of `0` represents immediate forwarding.
- `send_sms` refuses to post unless `GET /{userId}/sms` returns the requested (or first available) SMS extension.
- sipgate documents `POST /sessions/calls` as the classic-PBX Click2Dial route. The API documentation points Neo PBX accounts to `/calls`; supporting that distinct call workflow is left for a future compatibility pass.

## Read-only mode

Set `SIPGATE_MCP_READONLY=1` to register only the seven read tools. Write tools are absent from `tools/list`, rather than merely failing when called.

```bash
export SIPGATE_MCP_READONLY=1
npx -y sipgate-mcp
```

## MCP client configuration

Set `SIPGATE_TOKEN_ID` and `SIPGATE_TOKEN` in the environment that launches the MCP client. The examples keep secret values out of configuration files.

### Claude Code

Claude Code expands `${VAR}` references in MCP environment entries. Single quotes below prevent your shell from replacing the references before Claude stores them:

```bash
claude mcp add \
  --env 'SIPGATE_TOKEN_ID=${SIPGATE_TOKEN_ID}' \
  --env 'SIPGATE_TOKEN=${SIPGATE_TOKEN}' \
  --transport stdio \
  --scope user \
  sipgate -- npx -y sipgate-mcp
```

Add `--env SIPGATE_MCP_READONLY=1` before `--transport` for read-only mode. Verify the connection with `claude mcp get sipgate`. See the official [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp).

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
env_vars = ["SIPGATE_TOKEN_ID", "SIPGATE_TOKEN", "SIPGATE_MCP_READONLY"]
```

Export the variables before starting Codex, then use `/mcp` or `codex mcp list` to confirm the server. The `env_vars` forwarding form is documented in the [official OpenAI MCP documentation](https://developers.openai.com/codex/mcp/).

## Manual smoke test with MCP Inspector

This test makes real sipgate API calls. Start with a PAT containing only `account:read` and `numbers:read`, plus the required environment variables:

```bash
export SIPGATE_TOKEN_ID="your-token-id"
export SIPGATE_TOKEN="your-token"
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
    -> TelephonyBackend
      -> SipgateBackend (v1 implementation)
        -> SipgateClient
          -> native fetch -> https://api.sipgate.com/v2
```

`TelephonyBackend` contains the stable, provider-neutral operations. `SipgateBackend` is the only v1 implementation, so a future second telephony provider can reuse the same MCP tool surface.

## Security

- PAT values are read only from `SIPGATE_TOKEN_ID` and `SIPGATE_TOKEN`.
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

Tests use `node:test` and mocked `fetch`; they never call the real sipgate API. The suite includes client authentication/error behavior, exact critical write payloads, credential redaction, one test per MCP tool, and read-only registration.

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

- v1: local self-hosted stdio server (this release)
- v2: optional remote deployment, including a Cloudflare Workers backend, without changing the MCP tool surface
- Additional `TelephonyBackend` implementation(s)
- Product-aware Click2Dial behavior for classic and Neo PBX accounts

## License

MIT © 2026 Arne Wiese. See [LICENSE](LICENSE).
