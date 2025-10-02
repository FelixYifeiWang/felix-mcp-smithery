#!/usr/bin/env node
import dotenv from "dotenv";
dotenv.config();

import http from "http";
import { Server as MCPServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
// Optional: keep SSE for legacy/notifications if desired
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

// ---- Define your MCP server and tools ----
const mcp = new MCPServer(
  { name: "felix-mcp", version: "1.0.0" },
  {
    tools: {
      hello: {
        description: "Return a hello message",
        inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
        outputSchema: { type: "string" },
        handler: async ({ name }) => `Hello, ${name}! 👋`,
      },
      randomNumber: {
        description: "Return a random integer up to max (default 100)",
        inputSchema: { type: "object", properties: { max: { type: "number" } } },
        outputSchema: { type: "number" },
        handler: async ({ max = 100 }) => Math.floor(Math.random() * max),
      },
      weather: {
        description: "Get current weather for a city",
        inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
        outputSchema: { type: "string" },
        handler: async ({ city }) => {
          const url = `https://wttr.in/${encodeURIComponent(city)}?format=3`;
          const resp = await fetch(url);
          return `Weather in ${city}: ${await resp.text()}`;
        },
      },
      // (Optional) add summarize back after scan is green; remember to set OPENAI_API_KEY.
    },
  }
);

// ---- Utilities ----
const MCP_PATH = "/mcp";
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

// ---- Native HTTP server; single endpoint supports POST (+ optional GET SSE) ----
const server = http.createServer((req, res) => {
  // Normalize path (strip query & trailing slash)
  const [pathname] = (req.url || "").split("?");
  const isMcp = pathname === MCP_PATH || pathname === `${MCP_PATH}/`;

  // CORS / preflight everywhere
  setCors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (isMcp) {
    // Handle Streamable HTTP: client->server JSON-RPC over POST (REQUIRED)
    if (req.method === "POST") {
      const transport = new StreamableHTTPServerTransport({ request: req, response: res });
      mcp.connect(transport);
      return;
    }

    // Optional: allow GET to open an SSE stream for server->client messages
    if (req.method === "GET") {
      // If you don't want SSE, return 405 instead.
      const transport = new SSEServerTransport(req, res); // positional args per SDK
      mcp.connect(transport);
      return;
    }

    // Anything else at /mcp → 405
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method Not Allowed" }));
    return;
  }

  // Health/fallback
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("felix-mcp is alive");
});

// Bind on provided port/host
const port = Number(process.env.PORT || 3000);
server.keepAliveTimeout = 75_000;
server.headersTimeout = 90_000;

server.listen(port, "0.0.0.0", () => {
  console.log(`✅ MCP streamable HTTP on http://0.0.0.0:${port}${MCP_PATH}`);
});
