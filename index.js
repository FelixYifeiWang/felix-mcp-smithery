#!/usr/bin/env node
import dotenv from "dotenv";
dotenv.config();

import http from "http";
import { Server as MCPServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

// ---- tools factory so we can create a fresh server per request (stateless pattern) ----
function buildServer() {
  return new MCPServer(
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
        // (Re-add summarize later after scan succeeds & OPENAI_API_KEY is set)
      },
    }
  );
}

const MCP_PATHS = new Set(["", "/", "/mcp", "/mcp/"]);

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, mcp-session-id");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id"); // useful for browsers
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

const server = http.createServer(async (req, res) => {
  try {
    setCors(res);

    const [pathname] = (req.url || "").split("?");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health
    if (req.method === "GET" && (pathname === "/" || pathname === "")) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("felix-mcp is alive");
      return;
    }

    // Streamable HTTP JSON-RPC: accept POST on "/" or "/mcp"
    if (req.method === "POST" && MCP_PATHS.has(pathname)) {
      // Read the whole JSON body
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf8");
      let body = undefined;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }));
        return;
      }

      // Create fresh server & transport per request (stateless mode)
      const mcpServer = buildServer();
      const transport = new StreamableHTTPServerTransport({
        // stateless: no sessionIdGenerator
        sessionIdGenerator: undefined,
      });

      // If the client disconnects mid-request, close transport
      res.on("close", () => {
        try { transport.close?.(); } catch {}
        try { mcpServer.close?.(); } catch {}
      });

      // Connect and hand off the request to the transport
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    // Optional: you can 405 everything else
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found" }));
  } catch (err) {
    console.error("Server error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal Server Error" }));
    }
  }
});

// Keep-alive for reverse proxies
server.keepAliveTimeout = 75_000;
server.headersTimeout = 90_000;

const port = Number(process.env.PORT || 3000);
server.listen(port, "0.0.0.0", () => {
  console.log(`✅ MCP Streamable HTTP (stateless) on http://0.0.0.0:${port}  [POST / or /mcp]`);
});
