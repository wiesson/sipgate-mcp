---
name: sipgate-mcp
description: Install and securely configure the sipgate MCP server when a user asks to set up or connect a sipgate account to Codex or Claude. Do not use for ordinary sipgate product questions.
metadata:
  version: "0.5.0"
---

# Set up sipgate MCP

Install the matching CLI version with one available package manager:

```bash
vp install -g sipgate-mcp@0.5.0
```

```bash
npm install -g sipgate-mcp@0.5.0
```

```bash
pnpm add -g sipgate-mcp@0.5.0
```

Run only one install command. Confirm that `sipgate-mcp --version` reports
`0.5.0` before continuing.

## Security boundary

- Never ask the user to paste a sipgate PAT, token, client secret, or other
  credential into chat.
- Never place credentials in command arguments, MCP configuration, repository
  files, logs, or issue reports.
- The local server uses a sipgate Personal Access Token. A sipgate OAuth API
  client ID and secret are not substitutes for this local setup.
- Keep setup user-scoped. Let the setup prompt decide read-only versus write
  tools, and do not pass `--allow-writes` on the user's behalf. Never enable
  account-wide administrator access without an explicit user request.
- User scope remains the resource boundary for write tools: device IDs,
  phone-number IDs, emergency-address IDs, notification IDs, live-call
  participants, phonelines, nested parallel forwardings, voicemails and
  greetings, attached devices, faxlines, and automated-recording extensions
  are checked against the authenticated user's ownership before account
  changes are sent.
- Never display device credentials. Password rotation deliberately redacts the
  one-time password returned by sipgate.
- Fax send/resend and call-initiating voicemail playback/recording actions may
  incur charges. Call and automated recording are legally sensitive; in
  Germany the caller is responsible for obtaining every participant's consent,
  even when the recording announcement is off.
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
user-scoped stdio server. Its interactive prompt asks whether write tools should
be enabled; do not answer that choice on the user's behalf. The client starts
and stops that process, so do not launch `sipgate-mcp` as a daemon.

Version 0.5.0 adds user-scoped device, quick-dial, user-number, emergency-
address, notification, live-call-control, phoneline, voicemail/greeting,
automated-recording, and fax self-service. It supports accounts without
phonelines: direct number reads use `/{userId}/numbers`, ownership checks retain
the device-based number fallback, and phoneline-only tools return an explicit
unavailable result instead of surfacing sipgate's 403. Active calls are
filtered by participants matching owned devices or numbers; nested voicemail,
greeting, forwarding, attached-device, faxline, and recording-extension IDs
are verified before use. Device/faxline/phoneline creation, fax transmission,
call sessions, recording, and other writes may incur charges or carry legal
consequences, and address changes can deactivate associated numbers depending
on country.

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
