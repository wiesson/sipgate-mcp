import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRegistrationCommand,
  parseSetupArgs,
} from "../src/setup.js";

test("parseSetupArgs defaults to both clients and read-only mode", () => {
  assert.deepEqual(parseSetupArgs([]), {
    allowWrites: false,
    clients: ["codex", "claude"],
    dryRun: false,
  });
});

test("parseSetupArgs accepts client selection, writes, and dry-run", () => {
  assert.deepEqual(
    parseSetupArgs([
      "--client",
      "claude",
      "--client",
      "claude",
      "--allow-writes",
      "--dry-run",
    ]),
    {
      allowWrites: true,
      clients: ["claude"],
      dryRun: true,
    },
  );
});

test("parseSetupArgs rejects unknown clients", () => {
  assert.throws(() => parseSetupArgs(["--client", "cursor"]), /codex.*claude/);
});

test("buildRegistrationCommand creates secret-free Codex configuration", () => {
  const command = buildRegistrationCommand(
    "codex",
    "/node",
    "/sipgate-mcp/dist/index.js",
    false,
  );

  assert.deepEqual(command, {
    command: "codex",
    args: [
      "mcp",
      "add",
      "sipgate",
      "--env",
      "SIPGATE_MCP_SCOPE=user",
      "--env",
      "SIPGATE_MCP_READONLY=1",
      "--",
      "/node",
      "/sipgate-mcp/dist/index.js",
    ],
  });
});

test("buildRegistrationCommand creates user-scoped Claude configuration", () => {
  const command = buildRegistrationCommand(
    "claude",
    "/node",
    "/sipgate-mcp/dist/index.js",
    true,
  );

  assert.deepEqual(command, {
    command: "claude",
    args: [
      "mcp",
      "add",
      "--transport",
      "stdio",
      "--scope",
      "user",
      "--env",
      "SIPGATE_MCP_SCOPE=user",
      "--env",
      "SIPGATE_MCP_READONLY=0",
      "sipgate",
      "--",
      "/node",
      "/sipgate-mcp/dist/index.js",
    ],
  });
});
