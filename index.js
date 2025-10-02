#!/usr/bin/env node
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import OpenAI from "openai";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const app = express();
app.use(express.json());

// ---------- OpenAI client ----------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------- MCP SERVER ----------
const server = new Server(
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
        description: "Get current weather for a city",
        inputSchema: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"]
        },
        outputSchema: { type: "string" },
        handler: async ({ city }) => {
          const url = `https://wttr.in/${encodeURIComponent(city)}?format=3`;
          const resp = await fetch(url); // Node 18+ has global fetch
          const txt = await resp.text();
          return `Weather in ${city}: ${txt}`;
        }
      },

      summarize: {
        description: "Summarize a given text using OpenAI",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"]
        },
        outputSchema: { type: "string" },
        handler: async ({ text }) => {
          const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: "You are a concise, faithful summarizer." },
              { role: "user", content: `Summarize in 2–3 sentences:\n\n${text}` }
            ],
            max_tokens: 200
          });
          return completion.choices?.[0]?.message?.content?.trim() ?? "";
        }
      }
    }
  }
);

// ---------- Transports ----------
// 1) SSE for web (Smithery/public clients)
app.all("/mcp", (req, res) => {
  const transport = new SSEServerTransport({ req, res });
  server.connect(transport);
});

// 2) stdio for local Claude testing (optional)
// Enable by running with ENABLE_STDIO=1
if (process.env.ENABLE_STDIO === "1") {
  const stdio = new StdioServerTransport();
  server.connect(stdio);
}

// tiny health endpoint (optional)
app.get("/", (_req, res) => res.status(200).send("felix-mcp is alive"));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`MCP server on http://localhost:${port}  (SSE at /mcp)`);
});
