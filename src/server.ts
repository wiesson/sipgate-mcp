import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AccessScope, TelephonyBackend } from "./backend/telephony-backend.js";
import { requestJournal, type JournalEntry } from "./request-journal.js";
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

/**
 * A tool that failed after sipgate accepted one of its writes must not read
 * as a clean failure: an agent would retry and send a second SMS or place a
 * second call. The accepted requests are reported instead.
 */
function failureAfterWrites(error: unknown, journal: JournalEntry[]) {
  const accepted = journal.filter((entry) => entry.ok && entry.method !== "GET");
  if (accepted.length === 0) return undefined;
  const acceptedRequests = accepted.map((entry) => `${entry.method} ${entry.path}`);
  if (journal.some((entry) => !entry.ok && entry.method !== "GET")) {
    return {
      isError: true,
      content: [{
        type: "text" as const,
        text: `${publicError(error)} sipgate had already accepted these requests of the same tool call: ${acceptedRequests.join(", ")}. Check the current state before retrying anything.`,
      }],
    };
  }
  const identifiers = Object.assign({}, ...accepted.map((entry) => entry.identifiers ?? {}));
  const result = {
    applied: true,
    note: "sipgate accepted the change, but reading the resulting state back failed. Do not repeat the action; verify the current state with a read tool first.",
    acceptedRequests,
    ...(Object.keys(identifiers).length > 0 ? { identifiers } : {}),
    // Retry advice in the underlying error concerns the read, not the write.
    readbackError: publicError(error)
      .replace(/ (Check the network connection and try again|Try again later|Retry later)\.$/, ""),
  };
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
}

function jsonSchemaFor(schema: z.ZodType<Record<string, unknown>>): Tool["inputSchema"] {
  // Describe what a caller sends: fields with defaults are optional input.
  const generated = z.toJSONSchema(schema, { target: "draft-7", io: "input" });
  const { $schema: _ignored, ...inputSchema } = generated;
  return inputSchema as Tool["inputSchema"];
}

export function createServer(
  backend: TelephonyBackend,
  readonly = false,
  accessScope: AccessScope = "user",
  authenticatedUserId?: string,
): Server {
  const definitions = createToolDefinitions(backend, readonly, accessScope, authenticatedUserId);
  const byName = new Map(definitions.map((definition) => [definition.name, definition]));
  const server = new Server(
    { name: "sipgate-mcp", version: VERSION },
    {
      capabilities: { tools: {} },
      instructions: accessScope === "user"
        ? `This sipgate MCP is restricted to the authenticated user's resources. ${readonly ? "It is read-only and cannot change the account." : "It may change that user's telephony settings or initiate chargeable actions when explicitly requested. Account-wide contact, blacklist, porting-cancellation, and sipgate.io writes require an explicit confirmation argument."} Never request or infer another user's ID${authenticatedUserId === undefined ? "" : "; omit user_id to act as the authenticated user"}.`
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
    const journal: JournalEntry[] = [];
    try {
      const result = await requestJournal.run(
        journal,
        () => definition.execute(request.params.arguments ?? {}),
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return failureAfterWrites(error, journal) ?? {
        isError: true,
        content: [{ type: "text", text: publicError(error) }],
      };
    }
  });

  return server;
}
