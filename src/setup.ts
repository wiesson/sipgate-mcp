import { spawnSync } from "node:child_process";
import { closeSync, openSync, readSync } from "node:fs";
import { resolve } from "node:path";
import {
  loadStoredCredentials,
  storeCredentialsInteractively,
  type SipgateCredentials,
} from "./credentials.js";

export type SetupClient = "codex" | "claude";

export interface SetupOptions {
  /** undefined means the mode was not given on the command line and is asked for. */
  allowWrites: boolean | undefined;
  clients: SetupClient[];
  dryRun: boolean;
  replaceCredentials: boolean;
}

export interface ClientCommand {
  command: string;
  args: string[];
}

export class SetupError extends Error {}

export function parseSetupArgs(args: string[]): SetupOptions {
  const clients: SetupClient[] = [];
  let allowWrites: boolean | undefined;
  let dryRun = false;
  let replaceCredentials = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--allow-writes") {
      allowWrites = true;
      continue;
    }
    if (argument === "--read-only") {
      allowWrites = false;
      continue;
    }
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argument === "--replace-credentials") {
      replaceCredentials = true;
      continue;
    }
    if (argument === "--client") {
      const client = args[index + 1];
      if (client !== "codex" && client !== "claude") {
        throw new SetupError("--client must be either 'codex' or 'claude'.");
      }
      if (!clients.includes(client)) {
        clients.push(client);
      }
      index += 1;
      continue;
    }
    throw new SetupError(`Unknown setup option: ${argument ?? ""}`);
  }

  return {
    allowWrites,
    clients: clients.length > 0 ? clients : ["codex", "claude"],
    dryRun,
    replaceCredentials,
  };
}

export function readTtyLine(): string {
  const descriptor = openSync("/dev/tty", "r");
  try {
    const buffer = Buffer.alloc(256);
    const bytes = readSync(descriptor, buffer, 0, buffer.length, null);
    return buffer.subarray(0, bytes).toString("utf8").trim();
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Write tools place real calls and send real SMS, so the mode is a deliberate
 * choice rather than a silent default. An explicit flag wins; an interactive
 * run asks; a non-interactive run without a flag stays read-only.
 */
export function resolveWriteMode(
  allowWrites: boolean | undefined,
  interactive: boolean = process.stdin.isTTY === true,
  ask: () => string = readTtyLine,
  output: Pick<NodeJS.WriteStream, "write"> = process.stderr,
): boolean {
  if (allowWrites !== undefined) return allowWrites;
  if (!interactive) {
    output.write(
      "No mode selected and no terminal to ask. Registering read-only. Re-run with --allow-writes to enable calls, SMS, routing, and DND.\n",
    );
    return false;
  }
  output.write(
    "\nEnable write tools? They let the assistant place calls, send SMS, and change routing and DND.\n" +
    "Read-only mode can only look at your account.\n" +
    "Enable writes? [Y/n] ",
  );
  const answer = ask().toLowerCase();
  const enabled = answer === "" || answer === "y" || answer === "yes" || answer === "j" || answer === "ja";
  output.write(enabled ? "Write tools enabled.\n" : "Staying read-only.\n");
  return enabled;
}

export function buildRegistrationCommand(
  client: SetupClient,
  nodeExecutable: string,
  entrypoint: string,
  allowWrites: boolean,
): ClientCommand {
  const modeEnvironment = [
    "SIPGATE_MCP_SCOPE=user",
    `SIPGATE_MCP_READONLY=${allowWrites ? "0" : "1"}`,
  ];

  if (client === "codex") {
    return {
      command: "codex",
      args: [
        "mcp",
        "add",
        "sipgate",
        "--env",
        modeEnvironment[0]!,
        "--env",
        modeEnvironment[1]!,
        "--",
        nodeExecutable,
        entrypoint,
      ],
    };
  }

  const configuration = {
    type: "stdio",
    command: nodeExecutable,
    args: [entrypoint],
    env: {
      SIPGATE_MCP_SCOPE: "user",
      SIPGATE_MCP_READONLY: allowWrites ? "0" : "1",
    },
  };
  return {
    command: "claude",
    args: [
      "mcp",
      "add-json",
      "--scope",
      "user",
      "sipgate",
      JSON.stringify(configuration),
    ],
  };
}

export function ensureStoredCredentials(
  replaceCredentials: boolean,
  loadCredentials: () => SipgateCredentials | undefined = loadStoredCredentials,
  storeCredentials: () => void = storeCredentialsInteractively,
  output: Pick<NodeJS.WriteStream, "write"> = process.stderr,
): void {
  if (!replaceCredentials && loadCredentials()) {
    output.write(
      "Using the existing sipgate PAT-ID and PAT from macOS Keychain.\n",
    );
    return;
  }
  storeCredentials();
}

function isCommandAvailable(command: string): boolean {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return !result.error && result.status === 0;
}

function isAlreadyConfigured(client: SetupClient): boolean {
  const result = spawnSync(client, ["mcp", "get", "sipgate"], {
    stdio: "ignore",
  });
  return !result.error && result.status === 0;
}

function shellDisplay(command: ClientCommand): string {
  return [command.command, ...command.args]
    .map((part) => (/^[A-Za-z0-9_./:=+-]+$/.test(part) ? part : JSON.stringify(part)))
    .join(" ");
}

export function runSetup(
  args: string[],
  entrypointArgument: string | undefined = process.argv[1],
): void {
  const options = parseSetupArgs(args);
  if (!entrypointArgument) {
    throw new SetupError("Could not determine the sipgate-mcp entrypoint.");
  }

  const entrypoint = resolve(entrypointArgument);
  const allowWrites = options.dryRun
    ? options.allowWrites === true
    : resolveWriteMode(options.allowWrites);
  const commands = options.clients.map((client) => ({
    client,
    registration: buildRegistrationCommand(
      client,
      process.execPath,
      entrypoint,
      allowWrites,
    ),
  }));

  if (options.dryRun) {
    process.stdout.write("Dry run: no credentials or MCP configurations were changed.\n");
    for (const { registration } of commands) {
      process.stdout.write(`${shellDisplay(registration)}\n`);
    }
    return;
  }

  process.stderr.write(
    "sipgate-mcp stores the PAT-ID and PAT in macOS Keychain. Secret values are not written to MCP configuration or shell history.\n",
  );
  try {
    ensureStoredCredentials(options.replaceCredentials);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Secure credential storage failed.";
    throw new SetupError(message);
  }

  for (const { client, registration } of commands) {
    if (!isCommandAvailable(client)) {
      process.stderr.write(`Skipping ${client}: command not found.\n`);
      continue;
    }
    if (isAlreadyConfigured(client)) {
      process.stderr.write(
        `Skipping ${client}: an MCP server named 'sipgate' is already configured. Remove it first to replace its launch command.\n`,
      );
      continue;
    }

    const result = spawnSync(registration.command, registration.args, {
      stdio: "inherit",
    });
    if (result.error || result.status !== 0) {
      throw new SetupError(`Could not register sipgate-mcp with ${client}.`);
    }
    process.stderr.write(
      `Registered sipgate-mcp with ${client} in user scope (${allowWrites ? "writes enabled" : "read-only"}).\n`,
    );
  }

  process.stderr.write(
    "Setup complete. Restart Codex or Claude, open /mcp, and ask it to list your sipgate numbers.\n",
  );
}

export const SETUP_HELP = `Usage:
  sipgate-mcp                    Start the MCP stdio server
  sipgate-mcp setup [options]    Store credentials and register MCP clients
  sipgate-mcp --version          Print the installed version

Setup options:
  --client codex|claude          Register only this client (repeatable)
  --allow-writes                 Register write tools without asking
  --read-only                    Register read-only tools without asking
  --replace-credentials          Replace an existing PAT-ID and PAT in Keychain
  --dry-run                      Print registration commands without changing anything
`;
