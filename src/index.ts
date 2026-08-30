#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  AccessPolicyError,
  createAccessControlledBackend,
} from "./backend/access-controlled-backend.js";
import { SipgateBackend } from "./backend/sipgate-backend.js";
import { SipgateClient } from "./backend/sipgate-client.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";
import { runSetup, SETUP_HELP, SetupError } from "./setup.js";
import { VERSION } from "./version.js";

export async function main(): Promise<void> {
  const config = loadConfig();
  const client = new SipgateClient({ tokenId: config.tokenId, token: config.token });
  const sipgateBackend = new SipgateBackend(client);
  const backend = await createAccessControlledBackend(sipgateBackend, config.accessScope);
  const server = createServer(backend, config.readonly, config.accessScope);
  await server.connect(new StdioServerTransport());
}

export async function runCli(args: string[] = process.argv.slice(2)): Promise<void> {
  const command = args[0];
  if (command === "setup") {
    if (args[1] === "--help" || args[1] === "-h") {
      process.stdout.write(SETUP_HELP);
      return;
    }
    runSetup(args.slice(1));
    return;
  }
  if (command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(SETUP_HELP);
    return;
  }
  if (command === "--version" || command === "-V" || command === "version") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (command) {
    throw new SetupError(`Unknown command: ${command}`);
  }
  await main();
}

export function isMainModule(moduleUrl: string, entrypoint: string | undefined): boolean {
  if (!entrypoint) {
    return false;
  }

  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(entrypoint);
  } catch {
    return false;
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  runCli().catch((error: unknown) => {
    const detail =
      error instanceof AccessPolicyError || error instanceof SetupError
        ? ` ${error.message}`
        : "";
    console.error(`sipgate-mcp failed.${detail} Check credentials and MCP client configuration.`);
    process.exitCode = 1;
  });
}

export { SipgateBackend } from "./backend/sipgate-backend.js";
export {
  AccessPolicyError,
  createAccessControlledBackend,
} from "./backend/access-controlled-backend.js";
export { SipgateApiError, SipgateClient } from "./backend/sipgate-client.js";
export type {
  AccessScope,
  AuthenticatedUserContext,
  TelephonyBackend,
} from "./backend/telephony-backend.js";
export { createServer } from "./server.js";
export {
  loadStoredCredentials,
  storeCredentialsInteractively,
} from "./credentials.js";
export { buildRegistrationCommand, parseSetupArgs, runSetup } from "./setup.js";
export { createToolDefinitions } from "./tools/definitions.js";
export { VERSION } from "./version.js";
