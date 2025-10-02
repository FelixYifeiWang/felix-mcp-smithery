#!/usr/bin/env node
import dotenv from "dotenv";
dotenv.config();

import http from "http";
import { Server as MCPServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

// ---- MCP server and tools ----
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
      // Re-add summarize after scan is green (remember to set OPENAI_API_KEY)
    },
  }
);

const MCP_PATH = "/mcp";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

// ---- Native HTTP server; POST=/mcp uses StreamableHTTP transport (positional args) ----
const server = http.createServer((req, res) => {
  const [pathname] = (req.url || "").split("?");
  const atMcp = pathname === MCP_PATH || pathname === `${MCP_PATH}/`;

  // CORS preflight (safe to handle here)
  if (req.method === "OPTIONS") {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (atMcp) {
    // IMPORTANT: Don't set any headers before handing to transport.
    if (req.method === "POST") {
      // Positional (req, res) — NOT an options object
      const transport = new StreamableHTTPServerTransport(req, res);
      mcp.connect(transport);
      return; // transport will write/close the response
    }
    if (req.method === "GET") {
      // Optional SSE stream (also positional)
      const transport = new SSEServerTransport(req, res);
      mcp.connect(transport);
      return;
    }
    // Method not allowed at /mcp
    setCors(res);
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method Not Allowed" }));
    return;
  }

  // Health/fallback (OK to set CORS/headers here)
  setCors(res);
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("felix-mcp is alive");
});

// Keep-alive is helpful for long streams
server.keepAliveTimeout = 75_000;
server.headersTimeout = 90_000;

const port = Number(process.env.PORT || 3000);
server.listen(port, "0.0.0.0", () => {
  console.log(`✅ MCP Streamable HTTP on http://0.0.0.0:${port}${MCP_PATH}`);
});
