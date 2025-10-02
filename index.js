import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest, z } from "@modelcontextprotocol/sdk/types.js";

// ----- Build your MCP server (tools/resources/prompts) -----
function buildServer() {
  const server = new McpServer({ name: "felix-mcp", version: "1.0.0" });

  // hello(name)
  server.registerTool(
    "hello",
    {
      title: "Hello",
      description: "Return a hello message",
      inputSchema: { name: z.string() }
    },
    async ({ name }) => ({
      content: [{ type: "text", text: `Hello, ${name}! 👋` }]
    })
  );

  // randomNumber(max=100)
  server.registerTool(
    "randomNumber",
    {
      title: "Random number",
      description: "Return a random integer up to max (default 100)",
      inputSchema: { max: z.number().optional() }
    },
    async ({ max = 100 }) => ({
      content: [{ type: "text", text: String(Math.floor(Math.random() * max)) }]
    })
  );

  return server;
}

// ----- Express app with Streamable HTTP transport -----
const app = express();
const PORT = process.env.PORT || 8081;

app.use(express.json());

// CORS is important for remote/hosted runners (expose Mcp-Session-Id)
app.use(
  cors({
    origin: "*",                 // tighten in production
    exposedHeaders: ["Mcp-Session-Id"],
    allowedHeaders: ["Content-Type", "mcp-session-id", "Mcp-Session-Id"]
  })
);

// Maintain transports per session
/** @type {Record<string, StreamableHTTPServerTransport>} */
const transports = {};

// Health
app.get("/", (_req, res) => res.status(200).send("felix-mcp is alive"));

// POST /mcp — client→server messages, and init when no session yet
app.post("/mcp", async (req, res) => {
  try {
    const sessionId = /** @type {string | undefined} */ (
      req.headers["mcp-session-id"] || req.headers["Mcp-Session-Id"]
    );

    let transport = sessionId ? transports[sessionId] : undefined;

    // New session on first initialize
    if (!transport && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports[sid] = transport;
        }
      });

      // Build a fresh MCP server for this transport
      const server = buildServer();

      // Clean up when closed
      transport.onclose = () => {
        if (transport.sessionId) delete transports[transport.sessionId];
        try { server.close?.(); } catch {}
      };

      await server.connect(transport);
    }

    if (!transport) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session ID provided" },
        id: null
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("POST /mcp error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null
      });
    }
  }
});

// GET /mcp — server→client streaming (SSE)
app.get("/mcp", async (req, res) => {
  const sessionId = /** @type {string | undefined} */ (req.headers["mcp-session-id"]);
  const transport = sessionId && transports[sessionId];
  if (!transport) return res.status(400).send("Invalid or missing session ID");
  await transport.handleRequest(req, res);
});

// DELETE /mcp — end session
app.delete("/mcp", async (req, res) => {
  const sessionId = /** @type {string | undefined} */ (req.headers["mcp-session-id"]);
  const transport = sessionId && transports[sessionId];
  if (!transport) return res.status(400).send("Invalid or missing session ID");
  transport.close();
  res.status(204).end();
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ MCP Streamable HTTP server on 0.0.0.0:${PORT} (POST/GET/DELETE /mcp)`);
});
