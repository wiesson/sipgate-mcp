import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { TelephonyBackend } from "../src/backend/telephony-backend.js";
import { createServer } from "../src/server.js";

function backend(): TelephonyBackend {
  const mutation = async () => ({ before: null, after: null });
  return {
    getAccountInfo: async () => ({ account: { company: "Example" } }),
    listUsers: async () => ({ items: [] }),
    listNumbers: async () => ({ items: [] }),
    listDevices: async () => ({ items: [] }),
    getRouting: async () => ({ numbers: [], users: [] }),
    getCallHistory: async () => ({ items: [] }),
    getSettings: async () => ({ users: [] }),
    setNumberRouting: mutation,
    setForwarding: mutation,
    setDnd: mutation,
    sendSms: mutation,
    initiateCall: mutation,
  };
}

test("MCP server lists JSON-schema tools and executes a tool over the SDK transport", async () => {
  const server = createServer(backend());
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 12);
    assert.equal(listed.tools.find((tool) => tool.name === "call_history")?.inputSchema.type, "object");

    const result = await client.callTool({ name: "account_info", arguments: {} });
    assert.equal(result.isError, undefined);
    assert.match(JSON.stringify(result.content), /Example/);
  } finally {
    await client.close();
    await server.close();
  }
});
