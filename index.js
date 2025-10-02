// index.js
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import fetch from "node-fetch";

import { Server as MCPServer } from "@modelcontextprotocol/sdk/server/index.js";
import { HTTPServerTransport } from "@modelcontextprotocol/sdk/server/http.js";   // make sure your SDK is ≥ 1.17
import { SSEServerTransport }  from "@modelcontextprotocol/sdk/server/sse.js";

const app = express();
app.use(cors()); // allow any origin for Smithery runners & Claude
app.use(bodyParser.json({ limit: "1mb" }));

const PORT = process.env.PORT || 8081;

/**
 * We keep one MCP Server per session so capabilities & tools persist
 * across multiple requests from the same client.
 */
const sessions = new Map();

/** Build a server instance with your tools */
function buildServer() {
  const server = new MCPServer(
    { name: "felix-mcp", version: "1.0.0" },
    {
      tools: {
        hello: {
          description: "Return a hello message",
          inputSchema: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"]
          },
          outputSchema: { type: "string" },
          handler: async ({ name }) => `Hello, ${name}! 👋`
        },

        randomNumber: {
          description: "Return a random integer up to max (default 100)",
          inputSchema: {
            type: "object",
            properties: { max: { type: "number" } }
          },
          outputSchema: { type: "number" },
          handler: async ({ max = 100 }) => Math.floor(Math.random() * max)
        },

        weather: {
          description: "Get current weather for a city (wttr.in)",
          inputSchema: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"]
          },
          outputSchema: { type: "string" },
          handler: async ({ city }) => {
            const resp = await fetch(
              `https://wttr.in/${encodeURIComponent(city)}?format=3`
            );
            return await resp.text();
          }
        },

        // Uncomment if you want OpenAI summarization (set OPENAI_API_KEY)
        // summarize: {
        //   description: "Summarize text using OpenAI (2–3 sentences)",
        //   inputSchema: {
        //     type: "object",
        //     properties: { text: { type: "string" } },
        //     required: ["text"]
        //   },
        //   outputSchema: { type: "string" },
        //   handler: async ({ text }) => {
        //     if (!process.env.OPENAI_API_KEY) {
        //       throw new Error("OPENAI_API_KEY not set");
        //     }
        //     const r = await fetch("https://api.openai.com/v1/chat/completions", {
        //       method: "POST",
        //       headers: {
        //         "Content-Type": "application/json",
        //         "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
        //       },
        //       body: JSON.stringify({
        //         model: "gpt-4o-mini",
        //         messages: [
        //           { role: "system", content: "You are a crisp summarizer. 2–3 sentences max." },
        //           { role: "user", content: text }
        //         ],
        //         temperature: 0.2
        //       })
        //     });
        //     const j = await r.json();
        //     if (!r.ok) throw new Error(`OpenAI error: ${JSON.stringify(j)}`);
        //     return j.choices?.[0]?.message?.content ?? "No summary.";
        //   }
        // }
      }
    }
  );
  return server;
}

/** Ensure we have a server+transports for a given session id */
function getOrCreateSession(sessionId) {
  if (!sessions.has(sessionId)) {
    const server = buildServer();
    const session = {
      server,
      // We will create transports per incoming connection type (HTTP & SSE)
      httpTransport: new HTTPServerTransport(),
      // SSE transport will be created per SSE request (because it needs res)
    };
    // Connect the server to the HTTP transport once
    server.connect(session.httpTransport).catch((e) => {
      console.error("Failed to connect HTTP transport:", e);
    });
    sessions.set(sessionId, session);
  }
  return sessions.get(sessionId);
}

/** Basic health */
app.get("/", (_req, res) => {
  res.status(200).send("felix-mcp is alive");
});

/**
 * JSON-RPC over HTTP POST
 * Smithery/Claude send:
 *  - Content-Type: application/json
 *  - Mcp-Protocol-Version
 *  - Mcp-Session-Id
 */
app.post("/mcp", async (req, res) => {
  try {
    const sessionId = req.header("Mcp-Session-Id") || "default";
    const { httpTransport } = getOrCreateSession(sessionId);

    // Let the MCP SDK parse & handle the JSON-RPC body
    await httpTransport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("Error handling /mcp:", err);
    res.status(500).json({ jsonrpc: "2.0", error: { code: -32000, message: "Internal error" }, id: null });
  }
});

/**
 * Server-Sent Events stream (required by Smithery runner for streaming)
 * GET /mcp/sse
 */
app.get("/mcp/sse", async (req, res) => {
  try {
    const sessionId = req.header("Mcp-Session-Id") || "default";
    const session = getOrCreateSession(sessionId);

    // Create a fresh SSE transport bound to this response
    const sseTransport = new SSEServerTransport({ req, res });
    await session.server.connect(sseTransport);
    // NOTE: connect will take ownership of the res and keep it open.
  } catch (err) {
    console.error("Error handling /mcp/sse:", err);
    try {
      res.status(404).end();
    } catch {}
  }
});

app.listen(PORT, () => {
  console.log(`✅ MCP HTTP server ready on 0.0.0.0:${PORT}  (POST /mcp, SSE /mcp/sse)`);
});
