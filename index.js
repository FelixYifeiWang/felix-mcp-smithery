import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// Small helper to call OpenAI chat completions
async function openaiSummarize({ text, maxSentences = 3, model = "gpt-4o-mini" }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set on the server");
  }

  const body = {
    model,
    messages: [
      { role: "system", content: `You are a crisp summarizer. Limit to ${maxSentences} sentence(s). Be faithful, clear, and concise.` },
      { role: "user", content: text }
    ],
    temperature: 0.2
  };

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  const j = await r.json();
  if (!r.ok) {
    // Surface a readable error to the MCP client
    const msg = j?.error?.message || JSON.stringify(j);
    throw new Error(`OpenAI error: ${msg}`);
  }
  return j.choices?.[0]?.message?.content?.trim() || "No summary.";
}

// ----- Build your MCP server (tools/resources/prompts) -----
function buildServer() {
  const server = new McpServer({ name: "felix-mcp", version: "1.0.0" });

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

  server.registerTool(
    "weather",
    {
      title: "Weather",
      description: "Get current weather for a city (wttr.in)",
      inputSchema: { city: z.string() }
    },
    async ({ city }) => {
      const r = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=3`);
      const text = await r.text();
      return { content: [{ type: "text", text }] };
    }
  );

  server.registerTool(
    "summarize",
    {
      title: "Summarize",
      description: "Summarize text using OpenAI (default 1–3 sentences). Requires OPENAI_API_KEY.",
      inputSchema: {
        text: z.string().min(1, "Provide text to summarize"),
        maxSentences: z.number().int().min(1).max(6).optional(),
        model: z.string().optional()
      }
    },
    async ({ text, maxSentences = 3, model = "gpt-4o-mini" }) => {
      const summary = await openaiSummarize({ text, maxSentences, model });
      return { content: [{ type: "text", text: summary }] };
    }
  );

  return server;
}

// ----- Express app with Streamable HTTP transport -----
const app = express();
const PORT = process.env.PORT || 8081;

app.use(express.json());
app.use(
  cors({
    origin: "*",
    exposedHeaders: ["Mcp-Session-Id"],
    allowedHeaders: ["Content-Type", "mcp-session-id", "Mcp-Session-Id"]
  })
);

// Maintain transports per session
/** @type {Record<string, { transport: StreamableHTTPServerTransport, server: McpServer }>} */
const sessions = {};

// Health
app.get("/", (_req, res) => res.status(200).send("felix-mcp is alive"));

// POST /mcp — client→server messages, and init when no session yet
app.post("/mcp", async (req, res) => {
  try {
    const sessionIdHeader =
      /** @type {string|undefined} */ (req.headers["mcp-session-id"] || req.headers["Mcp-Session-Id"]);
    const existing = sessionIdHeader ? sessions[sessionIdHeader] : undefined;

    // New session on first initialize
    if (!existing && isInitializeRequest(req.body)) {
      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          sessions[sid] = { transport, server };
        }
      });

      // IMPORTANT: avoid close recursion — do NOT call server.close() here
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && sessions[sid]) {
          delete sessions[sid];
        }
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    if (!existing) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session ID provided" },
        id: null
      });
      return;
    }

    await existing.transport.handleRequest(req, res, req.body);
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
  const sid = /** @type {string|undefined} */ (req.headers["mcp-session-id"]);
  const sess = sid && sessions[sid];
  if (!sess) return res.status(400).send("Invalid or missing session ID");
  await sess.transport.handleRequest(req, res);
});

// DELETE /mcp — end session
app.delete("/mcp", async (req, res) => {
  const sid = /** @type {string|undefined} */ (req.headers["mcp-session-id"]);
  const sess = sid && sessions[sid];
  if (!sess) return res.status(400).send("Invalid or missing session ID");
  // Close the transport; onclose will clean up the map entry
  sess.transport.close();
  res.status(204).end();
});

// Optional: graceful shutdown without recursion
process.on("SIGTERM", () => {
  for (const sid of Object.keys(sessions)) {
    try { sessions[sid].transport.close(); } catch {}
    delete sessions[sid];
  }
  process.exit(0);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ MCP Streamable HTTP server on 0.0.0.0:${PORT} (POST/GET/DELETE /mcp)`);
});
