#!/usr/bin/env node
/**
 * cli.js — DevContext CLI
 * 
 * devctx setup          Auto-configure all detected editors (interactive)
 * devctx mcp            Start stdio MCP server
 * devctx http           Start HTTP/SSE MCP server
 * devctx setup --print  Print all config formats
 * devctx setup --path=  Write config to custom path
 * devctx setup --editor=cursor  Target specific editor
 */

const [,,cmd, ...rest] = process.argv;

switch (cmd) {
  case "setup":   await import("./setup.js"); break;
  case "mcp":     await import("./index.js"); break;
  case "http":    await import("./http.js");  break;
  default:
    console.log(`devctx <command>
  setup    Auto-configure all detected editors
  setup --editor=cursor     Target specific editor  
  setup --path=/my/cfg.json Write to custom config path
  setup --print             Print all config formats (no writes)
  setup --http              Configure HTTP transport instead of stdio
  mcp      Start stdio MCP server (used by editors internally)
  http     Start HTTP/SSE server (for editors that prefer URL-based MCP)

Supported editors (auto-detected):
  Cursor, Claude Desktop, Claude Code, Windsurf, Zed,
  VS Code (native), VS Code + Cline, VS Code + Continue, Neovim, Emacs

Any other editor → devctx setup (interactive mode shows all config formats)`);
}
