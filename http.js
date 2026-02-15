#!/usr/bin/env node
/**
 * http.js — HTTP/SSE transport for DevContext MCP
 */

import { createServer } from "http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema, ListToolsRequestSchema,
  ListResourcesRequestSchema, ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { handlers, toolsList, resourcesList } from "./handlers.js";

const ARGS = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith("--"))
    .map(a => { const [k,v] = a.slice(2).split("="); return [k, v ?? true]; })
);
const PORT = parseInt(ARGS.port || process.env.DEVCTX_PORT || "3741");
const HOST = ARGS.host || process.env.DEVCTX_HOST || "localhost";

const transports = new Map();

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, server: "devctx", version: "2.0.0", port: PORT }));
    return;
  }

  if (url.pathname === "/sse" && req.method === "GET") {
    console.error(`[devctx] New SSE client: ${req.headers["user-agent"] || "unknown"}`);

    const server = new Server(
      { name: "devctx", version: "2.0.0" },
      { capabilities: { tools: {}, resources: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolsList }));
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: resourcesList }));
    server.setRequestHandler(ReadResourceRequestSchema, handlers.readResource);
    server.setRequestHandler(CallToolRequestSchema, handlers.callTool);

    const transport = new SSEServerTransport("/message", res);
    const id = Date.now().toString();
    transports.set(id, transport);

    res.on("close", () => {
      transports.delete(id);
      console.error(`[devctx] SSE client disconnected`);
    });

    await server.connect(transport);
    return;
  }

  if (url.pathname === "/message" && req.method === "POST") {
    const sessionId = url.searchParams.get("sessionId");
    const transport = sessionId ? transports.get(sessionId) : [...transports.values()][0];

    if (!transport) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No active SSE connection" }));
      return;
    }

    let body = "";
    for await (const chunk of req) body += chunk;
    await transport.handlePostMessage(req, res, JSON.parse(body));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    error: "Not found",
    endpoints: {
      health: `GET http://${HOST}:${PORT}/health`,
      sse:    `GET http://${HOST}:${PORT}/sse`,
      msg:    `POST http://${HOST}:${PORT}/message`,
    },
  }));
});

httpServer.listen(PORT, HOST, () => {
  console.error(`[devctx] HTTP/SSE MCP server running at http://${HOST}:${PORT}`);
  console.error(`[devctx] SSE endpoint: http://${HOST}:${PORT}/sse`);
  console.error(`[devctx] Point your editor to the SSE endpoint above.`);
});

httpServer.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`[devctx] Port ${PORT} is in use. Try: node http.js --port=${PORT + 1}`);
  } else {
    console.error("[devctx] Server error:", e.message);
  }
  process.exit(1);
});
