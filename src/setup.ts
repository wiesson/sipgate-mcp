import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { storeCredentialsInteractively } from "./credentials.js";

export type SetupClient = "codex" | "claude";

export interface SetupOptions {
  allowWrites: boolean;
  clients: SetupClient[];
  dryRun: boolean;
}

export interface ClientCommand {
  command: string;
  args: string[];
}

export class SetupError extends Error {}

export function parseSetupArgs(args: string[]): SetupOptions {
  const clients: SetupClient[] = [];
  let allowWrites = false;
  let dryRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--allow-writes") {
      allowWrites = true;
      continue;
    }
    if (argument === "--dry-run") {
      dryRun = true;
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
  };
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

  return {
    command: "claude",
    args: [
      "mcp",
      "add",
      "--transport",
      "stdio",
      "--scope",
      "user",
      "--env",
      modeEnvironment[0]!,
      "--env",
      modeEnvironment[1]!,
      "sipgate",
      "--",
      nodeExecutable,
      entrypoint,
    ],
  };
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
  const commands = options.clients.map((client) => ({
    client,
    registration: buildRegistrationCommand(
      client,
      process.execPath,
      entrypoint,
      options.allowWrites,
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
    "sipgate-mcp will store the PAT in macOS Keychain. Secret values are not written to MCP configuration or shell history.\n",
  );
  try {
    storeCredentialsInteractively();
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
      `Registered sipgate-mcp with ${client} in user scope (${options.allowWrites ? "writes enabled" : "read-only"}).\n`,
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
  --allow-writes                 Register write tools; default is read-only
  --dry-run                      Print registration commands without changing anything
`;
