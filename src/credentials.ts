import { execFileSync, spawnSync } from "node:child_process";

export interface SipgateCredentials {
  tokenId: string;
  token: string;
}

export const MACOS_KEYCHAIN_SERVICE = "sipgate-mcp";
export const MACOS_KEYCHAIN_TOKEN_ID_ACCOUNT = "pat-token-id";
export const MACOS_KEYCHAIN_TOKEN_ACCOUNT = "pat-token";

type KeychainReader = (account: string) => string;
type KeychainWriter = (account: string) => void;

function defaultKeychainReader(account: string): string {
  return execFileSync(
    "/usr/bin/security",
    [
      "find-generic-password",
      "-s",
      MACOS_KEYCHAIN_SERVICE,
      "-a",
      account,
      "-w",
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  ).trim();
}

function defaultKeychainWriter(account: string): void {
  const result = spawnSync(
    "/usr/bin/security",
    [
      "add-generic-password",
      "-a",
      account,
      "-s",
      MACOS_KEYCHAIN_SERVICE,
      "-U",
      "-w",
    ],
    { stdio: "inherit" },
  );

  if (result.error || result.status !== 0) {
    throw new Error("macOS Keychain did not store the credential.");
  }
}

export function loadStoredCredentials(
  platform: NodeJS.Platform = process.platform,
  readKeychain: KeychainReader = defaultKeychainReader,
): SipgateCredentials | undefined {
  if (platform !== "darwin") {
    return undefined;
  }

  try {
    const tokenId = readKeychain(MACOS_KEYCHAIN_TOKEN_ID_ACCOUNT).trim();
    const token = readKeychain(MACOS_KEYCHAIN_TOKEN_ACCOUNT).trim();
    if (!tokenId || !token) {
      return undefined;
    }
    return { tokenId, token };
  } catch {
    return undefined;
  }
}

export function storeCredentialsInteractively(
  platform: NodeJS.Platform = process.platform,
  writeKeychain: KeychainWriter = defaultKeychainWriter,
  output: Pick<NodeJS.WriteStream, "write"> = process.stderr,
): void {
  if (platform !== "darwin") {
    throw new Error(
      "Secure interactive setup currently supports macOS Keychain only. Use SIPGATE_TOKEN_ID and SIPGATE_TOKEN on this platform.",
    );
  }

  output.write("Enter the sipgate PAT token ID in the macOS Keychain prompt.\n");
  writeKeychain(MACOS_KEYCHAIN_TOKEN_ID_ACCOUNT);
  output.write("Enter the sipgate PAT token in the macOS Keychain prompt.\n");
  writeKeychain(MACOS_KEYCHAIN_TOKEN_ACCOUNT);
}
