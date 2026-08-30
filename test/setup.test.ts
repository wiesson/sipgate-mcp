import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRegistrationCommand,
  ensureStoredCredentials,
  parseSetupArgs,
  resolveWriteMode,
} from "../src/setup.js";

test("parseSetupArgs defaults to both clients and an unset mode", () => {
  assert.deepEqual(parseSetupArgs([]), {
    allowWrites: undefined,
    clients: ["codex", "claude"],
    dryRun: false,
    replaceCredentials: false,
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
      "--replace-credentials",
    ]),
    {
      allowWrites: true,
      clients: ["claude"],
      dryRun: true,
      replaceCredentials: true,
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

test("buildRegistrationCommand creates secret-free user-scoped Claude JSON", () => {
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
      "add-json",
      "--scope",
      "user",
      "sipgate",
      JSON.stringify({
        type: "stdio",
        command: "/node",
        args: ["/sipgate-mcp/dist/index.js"],
        env: {
          SIPGATE_MCP_SCOPE: "user",
          SIPGATE_MCP_READONLY: "0",
        },
      }),
    ],
  });
});

test("ensureStoredCredentials reuses an existing Keychain entry", () => {
  let stores = 0;
  let output = "";
  ensureStoredCredentials(
    false,
    () => ({ tokenId: "stored-id", token: "stored-token" }),
    () => { stores += 1; },
    { write: (value) => {
      output += String(value);
      return true;
    } },
  );

  assert.equal(stores, 0);
  assert.match(output, /existing.*PAT-ID.*PAT/);
});

test("ensureStoredCredentials stores missing or explicitly replaced credentials", () => {
  let stores = 0;
  ensureStoredCredentials(false, () => undefined, () => { stores += 1; });
  ensureStoredCredentials(
    true,
    () => ({ tokenId: "stored-id", token: "stored-token" }),
    () => { stores += 1; },
  );

  assert.equal(stores, 2);
});

test("parseSetupArgs accepts an explicit read-only mode", () => {
  assert.equal(parseSetupArgs(["--read-only"]).allowWrites, false);
  assert.equal(parseSetupArgs(["--allow-writes"]).allowWrites, true);
});

function collector(): { write: (chunk: string) => boolean; text: string } {
  const sink = {
    text: "",
    write(chunk: string): boolean {
      sink.text += chunk;
      return true;
    },
  };
  return sink;
}

test("resolveWriteMode honours an explicit flag without asking", () => {
  const output = collector();
  const ask = (): string => assert.fail("should not prompt");

  assert.equal(resolveWriteMode(true, true, ask, output), true);
  assert.equal(resolveWriteMode(false, true, ask, output), false);
  assert.equal(output.text, "");
});

test("resolveWriteMode asks interactively and defaults to enabling writes", () => {
  const output = collector();

  assert.equal(resolveWriteMode(undefined, true, () => "", output), true);
  assert.equal(resolveWriteMode(undefined, true, () => "y", output), true);
  assert.equal(resolveWriteMode(undefined, true, () => "ja", output), true);
  assert.equal(resolveWriteMode(undefined, true, () => "n", output), false);
  assert.match(output.text, /Enable writes\? \[Y\/n\]/);
});

test("resolveWriteMode stays read-only when it cannot ask", () => {
  const output = collector();

  assert.equal(
    resolveWriteMode(undefined, false, () => assert.fail("should not prompt"), output),
    false,
  );
  assert.match(output.text, /--allow-writes/);
});
