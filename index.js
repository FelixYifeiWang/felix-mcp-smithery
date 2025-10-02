import http from "http";
import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

const app = express();
app.get("/", (_req, res) => res.status(200).send("felix-mcp is alive"));

// --- MCP server with your tools ---
const mcpServer = new Server(
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

      summarize: {
        description: "Summarize a given text using OpenAI",
        inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
        outputSchema: { type: "string" },
        handler: async ({ text }) => {
          // Lazy-create client so missing key doesn't crash boot
          const key = process.env.OPENAI_API_KEY;
          if (!key) throw new Error("OPENAI_API_KEY is not set");
          const { default: OpenAI } = await import("openai");
          const client = new OpenAI({ apiKey: key });

          const res = await client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: "You are a concise, faithful summarizer." },
              { role: "user", content: `Summarize in 2–3 sentences:\n\n${text}` },
            ],
            max_tokens: 200,
          });
          return res.choices?.[0]?.message?.content?.trim() ?? "";
        },
      },
    },
  }
);

// Create native HTTP server
const httpServer = http.createServer((req, res) => {
  if (req.url === "/mcp") {
    const transport = new SSEServerTransport({ req, res });
    mcpServer.connect(transport);
  } else {
    app(req, res); // delegate everything else to Express
  }
});

// Start listening
const port = process.env.PORT || 3000;
httpServer.listen(port, "0.0.0.0", () => {
  console.log(`✅ MCP listening on http://0.0.0.0:${port}/mcp`);
});