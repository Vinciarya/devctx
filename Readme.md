# DevContext MCP Server

> **"Git tracks your code history. DevContext tracks your intent history."**

Persistent AI coding context for teams — implemented as a **Model Context Protocol (MCP) server**.

---

## 🔥 ROAST OF THE ORIGINAL IDEA (AND HOW THIS FIXES IT)

### Problem 1 — Manual saving is a fantasy
The original CLI (`devctx save`) assumes developers will stop after every session and type structured context. They won't. Context saves need to be **automatic or near-zero friction**, not an interactive wizard.

**Fix:** `devctx_summarize` uses AI to read your git diff + recent commits and auto-generates the context entry. Zero typing required. Also: MCP agents can call `devctx_save` automatically mid-session.

### Problem 2 — The prompt was a wall of markdown
The original `devctx resume` just copied context to clipboard. But if your prompt is a markdown dump, the AI treats everything as equally important — it ignores half of it.

**Fix:** `buildResumePrompt()` uses a **structured, role-anchored prompt** with explicit sections:
- `ROLE` block — anchors the AI's mental model immediately
- `⛔ APPROACHES THAT FAILED` — prevents the AI from re-suggesting what didn't work
- `ARCHITECTURAL DECISIONS (SETTLED)` — stops the AI from relitigating closed debates
- `CONSTRAINTS` — hard limits the AI cannot violate
- `YOUR TASK NOW` — single, focused question (prevents rambling responses)

### Problem 3 — Clipboard is a terrible interface
Copy-paste is fragile. It doesn't work in automated pipelines, breaks in headless environments, and requires manual action each time.

**Fix:** This is an **MCP server**. Claude Code, Cursor, and Windsurf can read `devctx://context` as a **resource** — automatic context injection with zero paste-and-pray.

### Problem 4 — No failure memory
The original captured "approaches tried" as a flat string. If you write `"tried event sourcing"`, the AI doesn't know if it succeeded or failed. Next session, it suggests event sourcing again.

**Fix:** Approaches are structured as `{ description, failed: boolean, reason }`. Failed approaches are rendered in a clearly labeled `⛔` section that explicitly instructs the AI not to re-suggest them.

### Problem 5 — Team handoffs were treated as regular saves
Handing off to a teammate is a different communication act than saving your own context. It needs different framing, a different prompt structure, and explicit targeting.

**Fix:** `devctx_handoff` generates a teammate-specific prompt with a `Hey @user` opening, a "Don't Re-debate These" decisions block, and a "Your First Move" single-action opener.

### Problem 6 — `.devctx/` in git is a good idea, buried in a CLI flag
`devctx share` was an optional command. But committing context to git should be the **default workflow** — it's how teams sync without a backend.

**Fix:** All context is stored in `.devctx/` which is explicitly designed to be committed. `devctx_share` stages it for you. No backend required.

---

## Architecture

```
devctx/
├── src/
│   ├── index.js      ← MCP Server (all tools + resource)
│   ├── storage.js    ← .devctx/ persistence layer
│   ├── git.js        ← Git read/write helpers
│   ├── prompts.js    ← High-value structured prompt templates
│   └── cli.js        ← Optional CLI (delegates to same logic)
└── package.json
```

---

## Install

```bash
npm install -g devctx
```

Or run directly with npx (recommended for MCP):

```bash
npx -y devctx mcp
```

---

## MCP Configuration

Add to your MCP config file:

**Claude Code / Claude Desktop** (`~/.claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "devctx": {
      "command": "npx",
      "args": ["-y", "devctx", "mcp"]
    }
  }
}
```

**Cursor** (`.cursor/mcp.json` in repo or `~/.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "devctx": {
      "command": "npx",
      "args": ["-y", "devctx", "mcp"]
    }
  }
}
```

**Windsurf** (`.windsurf/mcp_config.json`):
```json
{
  "mcpServers": {
    "devctx": {
      "command": "npx",
      "args": ["-y", "devctx", "mcp"]
    }
  }
}
```

---

## MCP Tools Reference

| Tool | Description | Requires AI Key |
|------|-------------|:---:|
| `devctx_init` | Initialize .devctx/ in repo | No |
| `devctx_save` | Save context entry | No |
| `devctx_resume` | Generate restore prompt | No |
| `devctx_log` | View context history | No |
| `devctx_diff` | Git diff since last save | No |
| `devctx_handoff` | Create teammate handoff note | No |
| `devctx_share` | Stage .devctx/ for git commit | No |
| `devctx_summarize` | AI auto-generate context from git | ✅ |
| `devctx_suggest` | AI suggest next steps | ✅ |
| `devctx_compress` | Compress old history into summary | No |
| `devctx_config_set` | Set config value | No |
| `devctx_config_list` | View config | No |

## MCP Resource

| URI | Description |
|-----|-------------|
| `devctx://context` | Latest context for current branch (auto-injected) |
| `devctx://context/{branch}` | Context for a specific branch |
| `devctx://context/entry/{id}` | Specific context entry by ID |

---

## AI Features

Set your AI key:
```bash
export DEVCTX_AI_KEY=sk-...         # OpenAI key
export DEVCTX_AI_BASE_URL=...       # Optional: any OpenAI-compatible endpoint
```

Or pass `aiApiKey` / `aiBaseUrl` directly to `devctx_summarize` and `devctx_suggest`.

---

## Workflow Example

**End of session (Claude Code will call this automatically via MCP):**
```
devctx_save({
  task: "Refactoring payment service to use event sourcing",
  goal: "Decouple payment processing from order state management",
  approaches: [
    { description: "Direct DB write in payment handler", failed: true, reason: "Race condition on concurrent orders" },
    { description: "Saga pattern with Redis", failed: true, reason: "Ops doesn't want to run Redis" },
    { description: "Event sourcing with Postgres LISTEN/NOTIFY", failed: false }
  ],
  decisions: [
    "Using Postgres LISTEN/NOTIFY (not Kafka — overkill for current scale)",
    "Event schema is immutable — append-only, no updates"
  ],
  state: "PaymentEventStore class written, tests passing. OrderProjection half done.",
  nextSteps: [
    "Complete OrderProjection.rebuild() method",
    "Write migration for events table",
    "Update API layer to publish events instead of direct writes"
  ],
  constraints: [
    "Must not break existing /api/payments public API",
    "No new infrastructure dependencies"
  ]
})
```

**Next morning (any editor):**
```
devctx_resume({ branch: "feat/payment-event-sourcing" })
```

Returns a structured prompt ready to paste — with failed approaches clearly marked so the AI never suggests Redis again.

---

## CLI (Optional)

```bash
devctx init
devctx save                  # Interactive
devctx save "quick message"  # Quick mode
devctx save --auto           # From git history
devctx resume                # Copies prompt to clipboard
devctx log                   # History
devctx share                 # Stage for git
```

---

## How Context Is Stored

Each entry in `.devctx/` is a plain JSON file:

```json
{
  "id": "ctx_1720000000000_ab3f7",
  "timestamp": "2025-01-15T09:23:11.000Z",
  "branch": "feat/payment-event-sourcing",
  "task": "Refactoring payment service to use event sourcing",
  "goal": "Decouple payment processing from order state",
  "approaches": [
    { "description": "Saga with Redis", "failed": true, "reason": "No Redis in prod" }
  ],
  "decisions": ["Using Postgres LISTEN/NOTIFY"],
  "state": "PaymentEventStore done. OrderProjection 50% complete.",
  "nextSteps": ["Complete OrderProjection.rebuild()"],
  "constraints": ["Must not break public API"],
  "filesChanged": ["src/payments/EventStore.ts", "src/orders/Projection.ts"],
  "author": "Alice Chen",
  "metadata": { "commitHash": "a3f7c89" }
}
```

Commit `.devctx/` to git. That's your team sync layer — no backend required.

---

## License

MIT