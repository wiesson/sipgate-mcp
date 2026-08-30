import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AccessScope, TelephonyBackend } from "./backend/telephony-backend.js";
import { createToolDefinitions } from "./tools/definitions.js";
import { VERSION } from "./version.js";

function publicError(error: unknown): string {
  if (error instanceof z.ZodError) {
    const details = error.issues.map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    });
    return `Invalid tool input. ${details.join("; ")}`;
  }
  if (error instanceof Error && error.message) {
    return error.message.replace(/Basic\s+[A-Za-z0-9+/=]+/gi, "Basic [REDACTED]");
  }
  return "The sipgate operation failed unexpectedly.";
}

function jsonSchemaFor(schema: z.ZodType<Record<string, unknown>>): Tool["inputSchema"] {
  const generated = z.toJSONSchema(schema, { target: "draft-7" });
  const { $schema: _ignored, ...inputSchema } = generated;
  return inputSchema as Tool["inputSchema"];
}

export function createServer(
  backend: TelephonyBackend,
  readonly = false,
  accessScope: AccessScope = "user",
): Server {
  const definitions = createToolDefinitions(backend, readonly, accessScope);
  const byName = new Map(definitions.map((definition) => [definition.name, definition]));
  const server = new Server(
    { name: "sipgate-mcp", version: VERSION },
    {
      capabilities: { tools: {} },
      instructions: accessScope === "user"
        ? `This sipgate MCP is restricted to the authenticated user's resources. ${readonly ? "It is read-only and cannot change the account." : "It may change that user's telephony settings or initiate chargeable actions when explicitly requested. Account-wide contact, blacklist, porting-cancellation, and sipgate.io writes require an explicit confirmation argument."} Never request or infer another user's ID.`
        : `This sipgate MCP has account scope and the authenticated sipgate user was verified as an administrator. ${readonly ? "It is read-only and cannot change the account." : "It may change account-wide telephony settings or initiate chargeable actions when explicitly requested."}`,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: definitions.map((definition) => ({
      name: definition.name,
      description: definition.description,
      inputSchema: jsonSchemaFor(definition.inputSchema),
      annotations: definition.annotations,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const definition = byName.get(request.params.name);
    if (!definition) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
      };
    }
    try {
      const result = await definition.execute(request.params.arguments ?? {});
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: publicError(error) }],
      };
    }
  });

  return server;
}
