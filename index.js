import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import fetch from "node-fetch";

import { Server as MCPServer } from "@modelcontextprotocol/sdk/server/index.js";
import { HTTPServerTransport } from "@modelcontextprotocol/sdk/server/http.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "1mb" }));

const PORT = process.env.PORT || 8081;
const sessions = new Map();

function buildServer() {
  return new MCPServer(
    { name: "felix-mcp", version: "1.0.0" },
    {
      tools: {
        hello: {
          description: "Return a hello message",
          inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
          outputSchema: { type: "string" },
          handler: async ({ name }) => `Hello, ${name}! 👋`
        },
        randomNumber: {
          description: "Return a random integer up to max (default 100)",
          inputSchema: { type: "object", properties: { max: { type: "number" } } },
          outputSchema: { type: "number" },
          handler: async ({ max = 100 }) => Math.floor(Math.random() * max)
        },
        weather: {
          description: "Get current weather for a city (wttr.in)",
          inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
          outputSchema: { type: "string" },
          handler: async ({ city }) => {
            const r = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=3`);
            return await r.text();
          }
        }
      }
    }
  );
}

function getOrCreateSession(sessionId) {
  if (!sessions.has(sessionId)) {
    const server = buildServer();
    const httpTransport = new HTTPServerTransport();
    server.connect(httpTransport).catch((e) => console.error("HTTP transport connect failed:", e));
    sessions.set(sessionId, { server, httpTransport });
  }
  return sessions.get(sessionId);
}

app.get("/", (_req, res) => res.status(200).send("felix-mcp is alive"));

app.post("/mcp", async (req, res) => {
  try {
    const sessionId = req.header("Mcp-Session-Id") || "default";
    const { httpTransport } = getOrCreateSession(sessionId);
    await httpTransport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error("POST /mcp error:", e);
    res.status(500).json({ jsonrpc: "2.0", error: { code: -32000, message: "Internal error" }, id: null });
  }
});

app.get("/mcp/sse", async (req, res) => {
  try {
    const sessionId = req.header("Mcp-Session-Id") || "default";
    const { server } = getOrCreateSession(sessionId);
    const sse = new SSEServerTransport({ req, res });
    await server.connect(sse);
  } catch (e) {
    console.error("GET /mcp/sse error:", e);
    try { res.status(404).end(); } catch {}
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ MCP HTTP server ready on 0.0.0.0:${PORT}  (POST /mcp, SSE /mcp/sse)`);
});
