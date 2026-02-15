#!/usr/bin/env node
/**
 * DevContext MCP Server v2 — Token-Efficient, Universal
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema, ListToolsRequestSchema,
  ListResourcesRequestSchema, ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { handlers, toolsList, resourcesList } from "./handlers.js";

const server = new Server(
  { name: "devctx", version: "2.0.0" },
  { capabilities: { tools: {}, resources: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolsList }));
server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: resourcesList }));
server.setRequestHandler(ReadResourceRequestSchema, handlers.readResource);
server.setRequestHandler(CallToolRequestSchema, handlers.callTool);

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("DevContext MCP v2 running (stdio)\n");
