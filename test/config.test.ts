import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

const credentials = {
  SIPGATE_TOKEN_ID: "token-id",
  SIPGATE_TOKEN: "token-secret",
};

test("loadConfig defaults to user scope", () => {
  assert.deepEqual(loadConfig(credentials), {
    accessScope: "user",
    tokenId: "token-id",
    token: "token-secret",
    readonly: false,
  });
});

test("loadConfig accepts explicit account and read-only modes", () => {
  assert.deepEqual(loadConfig({
    ...credentials,
    SIPGATE_MCP_SCOPE: "account",
    SIPGATE_MCP_READONLY: "1",
  }), {
    accessScope: "account",
    tokenId: "token-id",
    token: "token-secret",
    readonly: true,
  });
});

test("loadConfig rejects unknown access scopes", () => {
  assert.throws(
    () => loadConfig({ ...credentials, SIPGATE_MCP_SCOPE: "organization" }),
    /SIPGATE_MCP_SCOPE/,
  );
});

test("loadConfig falls back to stored credentials", () => {
  assert.deepEqual(loadConfig({}, () => ({
    tokenId: "stored-id",
    token: "stored-token",
  })), {
    accessScope: "user",
    tokenId: "stored-id",
    token: "stored-token",
    readonly: false,
  });
});

test("loadConfig does not mix partial environment and stored credentials", () => {
  assert.throws(
    () => loadConfig({ SIPGATE_TOKEN_ID: "environment-id" }, () => ({
      tokenId: "stored-id",
      token: "stored-token",
    })),
    /Credentials are missing/,
  );
});

test("loadConfig reports missing environment and stored credentials", () => {
  assert.throws(
    () => loadConfig({}, () => undefined),
    /sipgate-mcp setup/,
  );
});
