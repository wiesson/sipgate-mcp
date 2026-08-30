#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SipgateBackend } from "./backend/sipgate-backend.js";
import { SipgateClient } from "./backend/sipgate-client.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

export async function main(): Promise<void> {
  const config = loadConfig();
  const client = new SipgateClient({ tokenId: config.tokenId, token: config.token });
  const backend = new SipgateBackend(client);
  const server = createServer(backend, config.readonly);
  await server.connect(new StdioServerTransport());
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
  main().catch(() => {
    console.error("sipgate-mcp failed to start. Check the required environment variables and MCP client configuration.");
    process.exitCode = 1;
  });
}

export { SipgateBackend } from "./backend/sipgate-backend.js";
export { SipgateApiError, SipgateClient } from "./backend/sipgate-client.js";
export type { TelephonyBackend } from "./backend/telephony-backend.js";
export { createServer } from "./server.js";
export { createToolDefinitions } from "./tools/definitions.js";
