import type { AccessScope } from "./backend/telephony-backend.js";

export interface ServerConfig {
  accessScope: AccessScope;
  tokenId: string;
  token: string;
  readonly: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const tokenId = env.SIPGATE_TOKEN_ID;
  const token = env.SIPGATE_TOKEN;
  if (!tokenId || !token) {
    throw new Error("Both SIPGATE_TOKEN_ID and SIPGATE_TOKEN must be set.");
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
