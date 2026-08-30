---
name: sipgate-mcp
description: Install and securely configure the sipgate MCP server when a user asks to set up or connect a sipgate account to Codex or Claude. Do not use for ordinary sipgate product questions.
metadata:
  version: "0.4.0"
---

# Set up sipgate MCP

Install the matching CLI version with one available package manager:

```bash
vp install -g sipgate-mcp@0.4.0
```

```bash
npm install -g sipgate-mcp@0.4.0
```

```bash
pnpm add -g sipgate-mcp@0.4.0
```

Run only one install command. Confirm that `sipgate-mcp --version` reports
`0.4.0` before continuing.

## Security boundary

- Never ask the user to paste a sipgate PAT, token, client secret, or other
  credential into chat.
- Never place credentials in command arguments, MCP configuration, repository
  files, logs, or issue reports.
- The local server uses a sipgate Personal Access Token. A sipgate OAuth API
  client ID and secret are not substitutes for this local setup.
- Keep the first setup user-scoped and read-only. Do not enable write tools or
  account-wide administrator access without an explicit user request.
- Do not remove or replace an existing MCP configuration without the user's
  approval.

## Configure

On macOS, run the interactive setup for the MCP client the user is currently
using:

```bash
sipgate-mcp setup --client codex
```

or:

```bash
sipgate-mcp setup --client claude
```

Omit `--client` only when both installed clients should be configured. The
setup delegates PAT entry directly to macOS Keychain and registers a
user-scoped, read-only stdio server. The client starts and stops that process;
do not launch `sipgate-mcp` as a daemon.

When credentials already exist in Keychain, setup reuses them without another
prompt. Use `--replace-credentials` only when the user explicitly wants to
rotate or replace the stored PAT-ID and PAT.

If the Keychain prompt cannot be presented in the current environment, ask the
user to run the setup command in their local interactive terminal. Do not ask
them to provide the credential to the agent instead. On Linux or Windows,
follow the secret-free environment or password-manager launcher guidance in
the project README rather than inventing a plaintext credential file.

If setup reports that an MCP server named `sipgate` already exists, inspect it
with `codex mcp get sipgate` or `claude mcp get sipgate`. Explain the conflict
and request approval before removing or replacing that configuration.

## Verify

Use the applicable client command:

```bash
codex mcp get sipgate
```

```bash
claude mcp get sipgate
```

Ask the user to restart the client when required, open `/mcp`, and test with:

> Use sipgate read-only. Check the connection and list my phone numbers.

Do not enable `--allow-writes` merely to make a failed read test pass. Diagnose
installation, credentials, client registration, and PAT read scopes first.
