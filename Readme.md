# DevContext MCP Server

> **"Git tracks your code history. DevContext tracks your intent history."**

DevContext brings **token-efficient, persistent intent history** to AI-native IDEs (Cursor, Claude Code, Windsurf, Zed, etc.) via the Model Context Protocol (MCP). It solves the "Goldfish Memory" problem by preserving architectural decisions, failed approaches, and task state across sessions.

---

## 🚀 Professional Workflow

DevContext is designed to be low-friction. It shouldn't feel like adding "documentation"; it's part of your development loop.

1.  **Initialize**: Run `devctx_init` once in your repository.
2.  **Save**: At the end of a session or after a major decision, run `devctx_save`.
3.  **Resume**: Starting a new session? Run `devctx_resume` to feed the AI exactly what happened since you were last here.
4.  **Sync**: Commit the `.devctx/` folder. Your team now has shared context without a database.

---

## 🛠️ Setup in Your IDE

Since this is a local server, you can point your editor directly to your local installation.

### 1. Installation

```bash
npm install                     # Install dependencies
node setup.js --print           # Preview your editor-specific config
```

### 2. Configure Editor (Recommended)

Run the interactive setup to auto-detect and configure your installed editors:

```bash
node setup.js
```

### 3. Manual Configuration

If you prefer manual setup, add this to your MCP settings file:

| Editor             | Settings File Location                         |
| :----------------- | :--------------------------------------------- |
| **Cursor**         | `~/.cursor/mcp.json`                           |
| **Claude Desktop** | `%APPDATA%\Claude\claude_desktop_config.json`  |
| **Windsurf**       | `~/.codeium/windsurf/mcp_config.json`          |
| **Antigravity**    | `~/.gemini/antigravity/mcp_config.json`        |
| **Zed**            | `settings.json` (Open via Zed command palette) |

**Stdio Config Example:**

```json
{
  "mcpServers": {
    "devctx": {
      "command": "node",
      "args": ["C:\\Path\\To\\devctx\\index.js"],
      "env": {}
    }
  }
}
```

---

## 🏃 Running & Testing

### 1. Manual Start (Debugging)

To verify the server starts correctly without an IDE:

```bash
# Start in Stdio mode (standard)
npm start

# Start in HTTP mode (for browser-based IDEs or remote access)
npm run http
```

### 2. Health Check

If running in HTTP mode, you can verify it's alive:

```bash
npm run health
# OR manually
curl http://localhost:3741/health
```

### 3. Testing with MCP Inspector

The gold standard for testing MCP servers is the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npx @modelcontextprotocol/inspector node index.js
```

This will open a web interface where you can manually trigger tools like `devctx_init` and see the JSON-RPC traffic.

---

## 📡 MCP Resources

DevContext provides resources that some IDEs can "subscribe" to for automatic context injection:

- `devctx://context` (80 tokens)
- `devctx://context/standard` (250 tokens)
- `devctx://context/full` (600 tokens)

_Note: Resources are "read-only" views of your latest context. Use tools (above) to modify the context._

---

## 🧩 Core Tools

| Tool               | Usage                                                                                     |
| :----------------- | :---------------------------------------------------------------------------------------- |
| `devctx_init`      | Setup `.devctx/` directory in the current project.                                        |
| `devctx_save`      | Save task, state, and **failed approaches** (stops AI from re-suggesting bad ideas).      |
| `devctx_resume`    | Restores context. Supports `tier`: `minimal` (80 tokens), `standard` (250), `full` (600). |
| `devctx_log`       | Review recent context snapshots and branch progress.                                      |
| `devctx_diff`      | Show git changes since last context save.                                                 |
| `devctx_handoff`   | Generate a specialized prompt for handing work to a teammate or AI sub-agent.             |
| `devctx_share`     | Stage `.devctx/` in git so teammates can sync context.                                    |
| `devctx_summarize` | AI-powered: Scans git diffs to auto-generate a context entry (Requires `DEVCTX_AI_KEY`).  |
| `devctx_suggest`   | AI-powered: Suggest next steps based on current context (Requires `DEVCTX_AI_KEY`).       |

---

## 💡 Why DevContext?

- **Token Efficiency**: A 600-token prompt injected 20 times wastes **12,000 tokens**. DevContext's `minimal` tier orientation uses only **80 tokens**—an 87% saving.
- **Explicit Failure Memory**: Tracks approaches as `{ failed: true, reason: "..." }`. The next session's AI is explicitly told _not_ to suggest those approaches again.
- **Git-Centric**: Context is stored as plain JSON in `.devctx/`. No external database, no cloud sub, just git.
- **Universal**: Works across any transport (Stdio or HTTP/SSE) and any editor supporting the Model Context Protocol.

---

## 📜 License

MIT
