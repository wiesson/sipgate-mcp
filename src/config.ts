import type { AccessScope } from "./backend/telephony-backend.js";
import {
  loadStoredCredentials,
  type SipgateCredentials,
} from "./credentials.js";

export interface ServerConfig {
  accessScope: AccessScope;
  tokenId: string;
  token: string;
  readonly: boolean;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  storedCredentialLoader: () => SipgateCredentials | undefined = loadStoredCredentials,
): ServerConfig {
  const hasEnvironmentCredential = Boolean(
    env.SIPGATE_TOKEN_ID || env.SIPGATE_TOKEN,
  );
  const storedCredentials = hasEnvironmentCredential
    ? undefined
    : storedCredentialLoader();
  const tokenId = env.SIPGATE_TOKEN_ID ?? storedCredentials?.tokenId;
  const token = env.SIPGATE_TOKEN ?? storedCredentials?.token;
  if (!tokenId || !token) {
    throw new Error(
      "Credentials are missing. Run 'sipgate-mcp setup' or set both SIPGATE_TOKEN_ID and SIPGATE_TOKEN.",
    );
  }
  const accessScope = env.SIPGATE_MCP_SCOPE ?? "user";
  if (accessScope !== "user" && accessScope !== "account") {
    throw new Error("SIPGATE_MCP_SCOPE must be either 'user' or 'account'.");
  }
  return {
    accessScope,
    tokenId,
    token,
    readonly: env.SIPGATE_MCP_READONLY === "1",
  };
}
