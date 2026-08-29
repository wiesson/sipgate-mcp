export interface ServerConfig {
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
  return { tokenId, token, readonly: env.SIPGATE_MCP_READONLY === "1" };
}
