#!/usr/bin/env node
/**
 * setup.js — Universal DevContext MCP Setup
 *
 * Works with ANY editor that supports MCP (stdio or HTTP transport).
 * Known editors auto-configured. Unknown editors → interactive prompt.
 *
 * Usage:
 *   node src/setup.js                    # auto-detect + interactive
 *   node src/setup.js --editor=cursor    # force specific editor
 *   node src/setup.js --path=/my/cfg.json # write to custom path
 *   node src/setup.js --http             # use HTTP transport instead of stdio
 *   node src/setup.js --print            # just print the config block, don't write
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, resolve, join } from "path";
import { homedir, platform } from "os";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { createInterface } from "readline";

const __dir   = dirname(fileURLToPath(import.meta.url));
const HOME    = homedir();
const OS      = platform(); // darwin | linux | win32
const SERVER  = resolve(join(__dir, "index.js"));
const HTTP_SERVER = resolve(join(__dir, "http.js"));

// ─── CLI Args ─────────────────────────────────────────────────────────────────
const ARGS = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith("--"))
    .map(a => { const [k, v] = a.slice(2).split("="); return [k, v ?? true]; })
);

// ─── Colors ───────────────────────────────────────────────────────────────────
const c = {
  g: s => `\x1b[32m${s}\x1b[0m`,
  y: s => `\x1b[33m${s}\x1b[0m`,
  r: s => `\x1b[31m${s}\x1b[0m`,
  b: s => `\x1b[1m${s}\x1b[0m`,
  d: s => `\x1b[2m${s}\x1b[0m`,
  c: s => `\x1b[36m${s}\x1b[0m`,
};

// ─── Interactive prompt ───────────────────────────────────────────────────────
function ask(question, fallback = "") {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(question, ans => { rl.close(); r(ans.trim() || fallback); }));
}

function askChoice(question, choices) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const list = choices.map((c, i) => `  ${i + 1}) ${c}`).join("\n");
  return new Promise(r => rl.question(`${question}\n${list}\n> `, ans => {
    rl.close();
    const n = parseInt(ans) - 1;
    r(choices[n] || choices[0]);
  }));
}

// ─── Config formats ───────────────────────────────────────────────────────────

/** Standard MCP JSON (Cursor, Claude Desktop, Claude Code, Windsurf, most editors) */
function stdioBlock(serverPath) {
  return { mcpServers: { devctx: { command: "node", args: [serverPath], env: {} } } };
}

/** HTTP/SSE transport block — for editors that prefer HTTP over stdio */
function httpBlock(port = 3741) {
  return { mcpServers: { devctx: { url: `http://localhost:${port}/sse` } } };
}

/** Zed uses context_servers instead of mcpServers */
function zedBlock(serverPath) {
  return { context_servers: { devctx: { command: { path: "node", args: [serverPath], env: {} } } } };
}

/** VS Code native MCP format (.vscode/mcp.json) */
function vscodeBlock(serverPath) {
  return { servers: { devctx: { type: "stdio", command: "node", args: [serverPath] } } };
}

/** Continue.dev config (goes in ~/.continue/config.json mcpServers array) */
function continueBlock(serverPath) {
  return { mcpServers: [{ name: "devctx", command: "node", args: [serverPath] }] };
}

/** Plain shell command — for editors with no config file, just a command field */
function shellCommand(serverPath) {
  return `node ${serverPath}`;
}

// ─── Merge helpers ────────────────────────────────────────────────────────────

function readJSON(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return {}; }
}

function writeJSON(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

/** Deep-merge our devctx entry into an existing config without destroying other keys */
function mergeInto(existing, block) {
  const merged = { ...existing };
  for (const [key, val] of Object.entries(block)) {
    if (typeof val === "object" && !Array.isArray(val) && existing[key]) {
      merged[key] = { ...existing[key], ...val };
    } else {
      merged[key] = val;
    }
  }
  return merged;
}

function applyConfig(configPath, block) {
  const existing = existsSync(configPath) ? readJSON(configPath) : {};
  const merged = mergeInto(existing, block);
  writeJSON(configPath, merged);
  return configPath;
}

// ─── Known editors registry ───────────────────────────────────────────────────
// To add a new editor: add an entry here. That's it.

const EDITORS = [
  {
    id: "cursor",
    name: "Cursor",
    detect: () => {
      if (OS === "darwin") return existsSync("/Applications/Cursor.app");
      if (OS === "win32")  return existsSync(join(process.env.LOCALAPPDATA||"", "Programs","cursor","Cursor.exe"));
      try { execSync("which cursor", { stdio:"ignore" }); return true; } catch { return false; }
    },
    configPath: () => {
      if (OS === "darwin") return join(HOME, ".cursor", "mcp.json");
      if (OS === "win32")  return join(process.env.APPDATA||HOME, "Cursor","User","mcp.json");
      return join(HOME, ".config","Cursor","User","mcp.json");
    },
    block: () => stdioBlock(SERVER),
    note: "Restart Cursor fully after setup.",
  },
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    detect: () => {
      if (OS === "darwin") return existsSync("/Applications/Claude.app");
      if (OS === "win32")  return existsSync(join(process.env.APPDATA||"", "Claude","Claude.exe"));
      return existsSync(join(HOME, ".config","Claude"));
    },
    configPath: () => {
      if (OS === "darwin") return join(HOME, "Library","Application Support","Claude","claude_desktop_config.json");
      if (OS === "win32")  return join(process.env.APPDATA||HOME, "Claude","claude_desktop_config.json");
      return join(HOME, ".config","Claude","claude_desktop_config.json");
    },
    block: () => stdioBlock(SERVER),
    note: "Restart Claude Desktop after setup.",
  },
  {
    id: "claude-code",
    name: "Claude Code",
    detect: () => { try { execSync("which claude", {stdio:"ignore"}); return true; } catch { return false; } },
    configPath: () => {
      if (OS === "win32") return join(process.env.APPDATA||HOME, "Claude","claude_desktop_config.json");
      return join(HOME, ".claude","claude_desktop_config.json");
    },
    block: () => stdioBlock(SERVER),
    note: `Or run: claude mcp add devctx node "${SERVER}"`,
  },
  {
    id: "windsurf",
    name: "Windsurf",
    detect: () => {
      if (OS === "darwin") return existsSync("/Applications/Windsurf.app");
      try { execSync("which windsurf", {stdio:"ignore"}); return true; } catch { return false; }
    },
    configPath: () => {
      if (OS === "darwin") return join(HOME, ".codeium","windsurf","mcp_config.json");
      if (OS === "win32")  return join(process.env.APPDATA||HOME, "Windsurf","mcp_config.json");
      return join(HOME, ".config","windsurf","mcp_config.json");
    },
    block: () => stdioBlock(SERVER),
    note: "Restart Windsurf after setup.",
  },
  {
    id: "zed",
    name: "Zed",
    detect: () => {
      if (OS === "darwin") return existsSync("/Applications/Zed.app");
      try { execSync("which zed", {stdio:"ignore"}); return true; } catch { return false; }
    },
    configPath: () => {
      if (OS === "darwin") return join(HOME, "Library","Application Support","Zed","settings.json");
      if (OS === "win32")  return join(process.env.APPDATA||HOME, "Zed","settings.json");
      return join(HOME, ".config","zed","settings.json");
    },
    block: () => zedBlock(SERVER),
    note: "Uses context_servers format. Restart Zed.",
  },
  {
    id: "vscode",
    name: "VS Code (native MCP)",
    detect: () => {
      try { execSync("which code", {stdio:"ignore"}); return true; } catch {
        if (OS === "darwin") return existsSync("/Applications/Visual Studio Code.app");
        return false;
      }
    },
    // VS Code native MCP: per-project .vscode/mcp.json
    configPath: () => join(process.cwd(), ".vscode", "mcp.json"),
    block: () => vscodeBlock(SERVER),
    note: "Writes to .vscode/mcp.json in current project. Commit this file.",
  },
  {
    id: "cline",
    name: "VS Code — Cline extension",
    detect: () => {
      const ext = OS === "darwin"
        ? join(HOME, ".vscode","extensions")
        : join(HOME, ".vscode","extensions");
      if (!existsSync(ext)) return false;
      try {
        const dirs = execSync("ls ~/.vscode/extensions 2>/dev/null || true", {encoding:"utf8"});
        return dirs.includes("saoudrizwan.claude-dev");
      } catch { return false; }
    },
    configPath: () => {
      if (OS === "darwin") return join(HOME, "Library","Application Support","Code","User","globalStorage","saoudrizwan.claude-dev","settings","cline_mcp_settings.json");
      if (OS === "win32")  return join(process.env.APPDATA||HOME, "Code","User","globalStorage","saoudrizwan.claude-dev","settings","cline_mcp_settings.json");
      return join(HOME, ".config","Code","User","globalStorage","saoudrizwan.claude-dev","settings","cline_mcp_settings.json");
    },
    block: () => stdioBlock(SERVER),
    note: "Cline MCP settings updated.",
  },
  {
    id: "continue",
    name: "VS Code — Continue extension",
    detect: () => {
      try {
        const dirs = execSync("ls ~/.vscode/extensions 2>/dev/null || true", {encoding:"utf8"});
        return dirs.includes("continue.continue");
      } catch { return false; }
    },
    configPath: () => join(HOME, ".continue", "config.json"),
    block: () => {
      // Continue uses an array format, handle separately
      return null; // handled in configure()
    },
    configure: () => {
      const path = join(HOME, ".continue", "config.json");
      mkdirSync(dirname(path), { recursive: true });
      const existing = existsSync(path) ? readJSON(path) : {};
      const servers = existing.mcpServers || [];
      const alreadyAdded = servers.some(s => s.name === "devctx");
      if (!alreadyAdded) {
        existing.mcpServers = [...servers, { name: "devctx", command: "node", args: [SERVER] }];
      }
      writeJSON(path, existing);
      return path;
    },
    note: "Restart VS Code after setup.",
  },
  {
    id: "neovim",
    name: "Neovim (mcphub.nvim)",
    detect: () => { try { execSync("which nvim", {stdio:"ignore"}); return true; } catch { return false; } },
    configPath: () => join(HOME, ".config", "mcphub", "servers.json"),
    block: () => stdioBlock(SERVER),
    note: "Requires mcphub.nvim plugin. See: github.com/ravitemer/mcphub.nvim",
  },
  {
    id: "emacs",
    name: "Emacs (mcp.el)",
    detect: () => { try { execSync("which emacs", {stdio:"ignore"}); return true; } catch { return false; } },
    configPath: () => join(HOME, ".config", "emacs", "mcp-servers.json"),
    block: () => stdioBlock(SERVER),
    note: "Requires mcp.el. See: github.com/lizqwerscott/mcp.el",
  },
  {
    id: "antigravity",
    name: "Antigravity (Agentic AI)",
    detect: () => {
      const path = OS === "win32"
        ? join(HOME, ".gemini", "antigravity", "mcp_config.json")
        : join(HOME, ".gemini", "antigravity", "mcp_config.json"); // Same for Linux/Mac in this env
      return existsSync(path);
    },
    configPath: () => {
      return join(HOME, ".gemini", "antigravity", "mcp_config.json");
    },
    block: () => stdioBlock(SERVER),
    note: "Restart your Antigravity session to see the new tools.",
  },
];

// ─── Configure one editor ─────────────────────────────────────────────────────

async function configureEditor(editor) {
  // Custom configure function if defined
  if (editor.configure) {
    const path = editor.configure();
    return { ok: true, path };
  }
  const path = applyConfig(editor.configPath(), editor.block());
  return { ok: true, path };
}

// ─── Manual / custom editor flow ─────────────────────────────────────────────

async function configureCustomEditor() {
  console.log(`\n${c.b("Custom Editor Setup")}`);
  console.log("No problem — DevContext works with any MCP-compatible editor.\n");

  const transport = await askChoice("What transport does your editor support?", [
    "stdio (node process — most common)",
    "HTTP/SSE (URL-based)",
    "I'll paste the config manually",
  ]);

  if (transport.startsWith("stdio")) {
    console.log(`\n${c.b("Add this to your editor's MCP config:")}\n`);
    console.log(JSON.stringify(stdioBlock(SERVER), null, 2));
    console.log(`\n${c.d("The command to run the server:")}`);
    console.log(c.c(`  node ${SERVER}`));
    return;
  }

  if (transport.startsWith("HTTP")) {
    const port = await ask("Port to run HTTP server on? [3741]: ", "3741");
    console.log(`\n${c.b("1. Start the HTTP server:")}`);
    console.log(c.c(`  node ${HTTP_SERVER} --port=${port}`));
    console.log(`\n${c.b("2. Add this URL to your editor's MCP config:")}`);
    console.log(c.c(`  http://localhost:${port}/sse`));
    console.log(`\nOr use the JSON block:`);
    console.log(JSON.stringify(httpBlock(parseInt(port)), null, 2));
    return;
  }

  // Manual paste flow
  console.log(`\n${c.b("Here are all config formats — pick the one your editor uses:")}\n`);

  console.log(`${c.b("Standard JSON (most editors — Cursor, Claude, Windsurf, etc.)")}`);
  console.log(JSON.stringify(stdioBlock(SERVER), null, 2));

  console.log(`\n${c.b("Zed (context_servers format)")}`);
  console.log(JSON.stringify(zedBlock(SERVER), null, 2));

  console.log(`\n${c.b("VS Code native MCP (.vscode/mcp.json)")}`);
  console.log(JSON.stringify(vscodeBlock(SERVER), null, 2));

  console.log(`\n${c.b("Continue.dev (mcpServers array)")}`);
  console.log(JSON.stringify({ mcpServers: [{ name: "devctx", command: "node", args: [SERVER] }] }, null, 2));

  console.log(`\n${c.b("Shell command (for editors with a 'command' field)")}`);
  console.log(c.c(`  ${shellCommand(SERVER)}`));

  console.log(`\n${c.d("Still can't find the right format? Open an issue and paste your editor's MCP docs.")}`);
}

// ─── Write to explicit path ───────────────────────────────────────────────────

async function configureExplicitPath(configPath, useHttp, port) {
  if (useHttp) {
    applyConfig(configPath, httpBlock(port));
    console.log(`${c.g("✅")} Written HTTP config to ${c.d(configPath)}`);
    console.log(`   Start HTTP server: ${c.c(`node ${HTTP_SERVER} --port=${port}`)}`);
  } else {
    applyConfig(configPath, stdioBlock(SERVER));
    console.log(`${c.g("✅")} Written stdio config to ${c.d(configPath)}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${c.b("╔══════════════════════════════════════╗")}`);
  console.log(`${c.b("║  DevContext MCP — Universal Setup    ║")}`);
  console.log(`${c.b("╚══════════════════════════════════════╝")}\n`);

  const useHttp = !!ARGS.http;
  const httpPort = parseInt(ARGS.port || "3741");

  // --print: just dump config blocks and exit
  if (ARGS.print) {
    console.log("stdio config:\n", JSON.stringify(stdioBlock(SERVER), null, 2));
    console.log("\nHTTP config:\n", JSON.stringify(httpBlock(httpPort), null, 2));
    console.log("\nZed config:\n", JSON.stringify(zedBlock(SERVER), null, 2));
    console.log("\nVS Code config:\n", JSON.stringify(vscodeBlock(SERVER), null, 2));
    console.log(`\nShell command: ${shellCommand(SERVER)}`);
    return;
  }

  // --path: write to explicit file
  if (ARGS.path) {
    await configureExplicitPath(resolve(ARGS.path), useHttp, httpPort);
    return;
  }

  // --editor: target a specific editor
  if (ARGS.editor) {
    const editor = EDITORS.find(e => e.id === ARGS.editor);
    if (!editor) {
      console.log(c.y(`Unknown editor '${ARGS.editor}'. Available: ${EDITORS.map(e=>e.id).join(", ")}, or use --path=/your/config.json`));
      await configureCustomEditor();
      return;
    }
    const r = await configureEditor(editor);
    console.log(`${c.g("✅")} ${editor.name} configured`);
    console.log(`   ${c.d(r.path)}`);
    console.log(`   ${c.d(editor.note)}`);
    return;
  }

  // Auto-detect all installed editors
  console.log("Scanning for installed editors...\n");
  const detected = EDITORS.filter(e => { try { return e.detect(); } catch { return false; } });
  const missed   = EDITORS.filter(e => !detected.includes(e));

  if (detected.length === 0) {
    console.log(c.y("No known editors detected on this machine."));
    await configureCustomEditor();
    return;
  }

  console.log(`Found ${c.b(detected.length)} editor(s):\n`);
  detected.forEach(e => console.log(`  ${c.g("✓")} ${e.name}`));
  if (missed.length) {
    console.log(c.d(`\nNot found: ${missed.map(e=>e.name).join(", ")}`));
  }
  console.log("");

  // Configure all detected
  const results = [];
  for (const editor of detected) {
    try {
      const r = await configureEditor(editor);
      results.push({ name: editor.name, ok: true, path: r.path });
      console.log(`${c.g("✅")} ${c.b(editor.name)}`);
      console.log(`   ${c.d(r.path)}`);
      console.log(`   ${c.d(editor.note)}\n`);
    } catch (e) {
      results.push({ name: editor.name, ok: false, error: e.message });
      console.log(`${c.r("❌")} ${editor.name}: ${e.message}\n`);
    }
  }

  // Offer custom editor config for anything else
  const doCustom = await ask("Configure another editor not listed above? [y/N]: ", "n");
  if (doCustom.toLowerCase() === "y") {
    await configureCustomEditor();
  }

  // Final summary
  const ok  = results.filter(r => r.ok).length;
  const bad = results.filter(r => !r.ok);
  console.log(`\n${c.b(`Done: ${ok}/${detected.length} editors configured.`)}`);
  if (bad.length) {
    console.log(c.y("Failed editors — use --print to get config blocks to paste manually:"));
    bad.forEach(r => console.log(`  ${r.name}: ${r.error}`));
  }

  console.log(`\n${c.b("Verify it works — type this in any configured editor:")}`);
  console.log(c.c(`  Use devctx_init`));
  console.log(`Expected: ${c.g('{ "ok": true, "msg": "Initialized .devctx/" }')}`);
  console.log(`\n${c.d("Then save your first context:")}`);
  console.log(c.c(`  Use devctx_save with task: "what you're working on"\n`));
}

main().catch(e => { console.error(c.r("Setup error:"), e.message); process.exit(1); });
