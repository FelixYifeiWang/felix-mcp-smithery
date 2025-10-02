#!/usr/bin/env node
import dotenv from "dotenv";
dotenv.config();

import http from "http";
import { Server as MCPServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

// ---- Define your MCP server & tools ----
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
          const txt = await resp.text();
          return `Weather in ${city}: ${txt}`;
        },
      },
      // You can add summarize later once the scan is green (remember OPENAI_API_KEY)
    },
  }
);

const MCP_PATH = "/mcp";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

const server = http.createServer((req, res) => {
  // Log every request so we can see what the scanner is doing
  console.log(`[req] ${req.method} ${req.url}`);

  setCors(res);

  // Fast path for CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Normalize path (strip query)
  const [pathname] = (req.url || "").split("?");

  // ----- Handle MCP JSON-RPC over Streamable HTTP on both "/" and "/mcp"
  const isMcpPost =
    req.method === "POST" &&
    (pathname === "/" || pathname === "" || pathname === MCP_PATH || pathname === `${MCP_PATH}/`);

  if (isMcpPost) {
    try {
      // This transport reads the request stream and writes a JSON-RPC response
      const transport = new StreamableHTTPServerTransport({ request: req, response: res });
      mcp.connect(transport);
    } catch (e) {
      console.error("StreamableHTTP error:", e);
      // Ensure the response is closed on error to avoid timeouts
      try {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal Server Error" }));
      } catch {}
    }
    return;
  }

  // ----- Optional: allow GET /mcp to open an SSE stream (not required for scanner)
  if (req.method === "GET" && (pathname === MCP_PATH || pathname === `${MCP_PATH}/`)) {
    console.log("[/mcp] GET -> SSE");
    const transport = new SSEServerTransport(req, res); // positional args for SDK 1.x
    mcp.connect(transport);
    return;
  }

  // ----- Health / everything else
  if (req.method === "GET" && (pathname === "/" || pathname === "")) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("felix-mcp is alive");
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found" }));
});

// Keep-alive tuned for reverse proxies
server.keepAliveTimeout = 75_000;
server.headersTimeout = 90_000;

// Bind to the port Smithery gives us
const port = Number(process.env.PORT || 3000);
server.listen(port, "0.0.0.0", () => {
  console.log(`✅ MCP Streamable HTTP ready on http://0.0.0.0:${port}${MCP_PATH} (and POST on "/")`);
});
