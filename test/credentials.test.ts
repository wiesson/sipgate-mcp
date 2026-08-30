import assert from "node:assert/strict";
import test from "node:test";
import {
  loadStoredCredentials,
  MACOS_KEYCHAIN_TOKEN_ACCOUNT,
  MACOS_KEYCHAIN_TOKEN_ID_ACCOUNT,
  storeCredentialsInteractively,
} from "../src/credentials.js";

test("loadStoredCredentials reads both PAT values from macOS Keychain", () => {
  const accounts: string[] = [];
  const credentials = loadStoredCredentials("darwin", (account) => {
    accounts.push(account);
    return account === MACOS_KEYCHAIN_TOKEN_ID_ACCOUNT
      ? "token-id\n"
      : "token-secret\n";
  });

  assert.deepEqual(credentials, {
    tokenId: "token-id",
    token: "token-secret",
  });
  assert.deepEqual(accounts, [
    MACOS_KEYCHAIN_TOKEN_ID_ACCOUNT,
    MACOS_KEYCHAIN_TOKEN_ACCOUNT,
  ]);
});

test("loadStoredCredentials is unavailable off macOS", () => {
  assert.equal(
    loadStoredCredentials("linux", () => {
      throw new Error("must not run");
    }),
    undefined,
  );
});

test("loadStoredCredentials hides Keychain lookup failures", () => {
  assert.equal(
    loadStoredCredentials("darwin", () => {
      throw new Error("not found");
    }),
    undefined,
  );
});

test("storeCredentialsInteractively requests both values without receiving secrets", () => {
  const accounts: string[] = [];
  let output = "";
  storeCredentialsInteractively(
    "darwin",
    (account) => accounts.push(account),
    { write: (value) => {
      output += String(value);
      return true;
    } },
  );

  assert.deepEqual(accounts, [
    MACOS_KEYCHAIN_TOKEN_ID_ACCOUNT,
    MACOS_KEYCHAIN_TOKEN_ACCOUNT,
  ]);
  assert.match(output, /PAT token ID/);
  assert.match(output, /PAT token/);
});
