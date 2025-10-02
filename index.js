#!/usr/bin/env node
import dotenv from "dotenv";
dotenv.config();

import http from "http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

// --- Define MCP tools ---
const mcp = new Server(
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
      // You can add summarize back after scan succeeds (remember OPENAI_API_KEY)
    },
  }
);

// --- Native HTTP server; mount SSE at /mcp ---
const server = http.createServer((req, res) => {
  if (req.url === "/mcp") {
    console.log("[/mcp] incoming connection");
    // IMPORTANT: pass positional (req, res), not an object
    const transport = new SSEServerTransport(req, res);
    mcp.connect(transport);
    return;
  }

  // Health/fallback
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("felix-mcp is alive");
});

const port = Number(process.env.PORT || 3000);
server.listen(port, "0.0.0.0", () => {
  console.log(`✅ MCP listening on http://0.0.0.0:${port}/mcp`);
});
