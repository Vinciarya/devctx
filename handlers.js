import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

import {
  initRepo,
  saveContext,
  loadLatest,
  loadById,
  listEntries,
  isInitialized,
  loadConfig,
  saveConfig,
} from "./storage.js";
import {
  getCurrentBranch,
  getLatestCommit,
  isGitRepo,
  getGitUser,
  getChangedFiles,
  getRecentCommits,
  getDiffStat,
  stageDevctx,
} from "./git.js";
import {
  buildMinimal,
  buildStandard,
  buildFull,
  buildHandoff,
  buildSummarizePrompt,
  buildSuggestPrompt,
} from "./prompts.js";
// import { countEntryTokens, TIER } from "./tokens.js"; // Not used in handlers currently but index had it

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Lean success response — just the facts, no padding */
function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

async function callAI(prompt, apiKey, baseUrl = "https://api.openai.com/v1") {
  const key = apiKey || process.env.DEVCTX_AI_KEY;
  if (!key) throw new Error("No AI key. Set DEVCTX_AI_KEY or pass aiApiKey.");
  const r = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    }),
  });
  if (!r.ok) throw new Error(`AI error: ${r.status}`);
  const d = await r.json();
  return d.choices[0].message.content.replace(/```json|```/g, "").trim();
}

// ─── Tool Handlers ────────────────────────────────────────────────────────────

async function handleInit({ cwd: rawCwd }) {
  const cwd = rawCwd || process.cwd();
  const r = initRepo(cwd);
  return ok(
    r.created
      ? { ok: true, msg: "Initialized .devctx/" }
      : { ok: true, msg: "Already initialized" },
  );
}

async function handleSave(args) {
  const cwd = args.cwd || process.cwd();
  if (!isInitialized(cwd)) initRepo(cwd);

  const branch = getCurrentBranch(cwd);
  const entry = saveContext(
    {
      branch,
      task: args.task,
      goal: args.goal || null,
      state: args.state || null,
      approaches: args.approaches || [],
      decisions: args.decisions || [],
      nextSteps: args.nextSteps || [],
      constraints: args.constraints || [],
      filesChanged: args.filesChanged || getChangedFiles(5, cwd),
      author: getGitUser(cwd)?.name || null,
      meta: { commitHash: getLatestCommit(cwd) },
    },
    cwd,
  );

  return ok({
    id: entry.id,
    branch,
    tokens: entry.tokenCount,
    task: entry.task,
  });
}

async function handleResume(args) {
  const cwd = args.cwd || process.cwd();
  const branch = args.branch || getCurrentBranch(cwd);
  const entry = args.id
    ? loadById(args.id, branch, cwd)
    : loadLatest(branch, cwd);

  if (!entry)
    return ok({
      found: false,
      msg: `No context for branch '${branch}'. Run devctx_save first.`,
    });

  const tier = args.tier || "standard";
  const builders = {
    minimal: buildMinimal,
    standard: buildStandard,
    full: buildFull,
  };
  const build = builders[tier] || buildStandard;
  const prompt = build(entry, args.focus || null);

  return ok({
    found: true,
    branch: entry.branch,
    task: entry.task,
    savedAt: entry.timestamp?.slice(0, 16),
    tier,
    promptTokens: Math.ceil(prompt.length / 4),
    prompt,
  });
}

async function handleLog(args) {
  const cwd = args.cwd || process.cwd();
  const entries = listEntries(args.branch || null, args.limit || 10, cwd);
  return ok({ count: entries.length, entries });
}

async function handleDiff(args) {
  const cwd = args.cwd || process.cwd();
  const branch = getCurrentBranch(cwd);
  const entry = loadLatest(branch, cwd);
  const since = entry?.meta?.commitHash || null;
  const stat = getDiffStat(since, cwd);
  return ok({ branch, since: since?.slice(0, 8) || "HEAD", diff: stat });
}

async function handleHandoff(args) {
  const cwd = args.cwd || process.cwd();
  const branch = getCurrentBranch(cwd);
  const fromUser = getGitUser(cwd)?.name || "unknown";

  const entry = saveContext(
    {
      branch,
      task: args.task,
      goal: args.goal,
      state: args.state,
      approaches: args.approaches || [],
      decisions: args.decisions || [],
      nextSteps: args.nextSteps || [],
      author: fromUser,
      meta: { type: "handoff", to: args.to },
    },
    cwd,
  );

  const prompt = buildHandoff(entry, fromUser, args.to);
  return ok({
    id: entry.id,
    to: args.to,
    promptTokens: Math.ceil(prompt.length / 4),
    prompt,
  });
}

async function handleShare(args) {
  const cwd = args.cwd || process.cwd();
  if (!isGitRepo(cwd)) return ok({ ok: false, msg: "Not a git repo." });
  const staged = stageDevctx(cwd);
  return ok({
    ok: staged,
    msg: staged
      ? '.devctx/ staged. Commit with: git commit -m "chore: sync devctx"'
      : "Staging failed.",
  });
}

async function handleSummarize(args) {
  const cwd = args.cwd || process.cwd();
  const commits = getRecentCommits(args.n || 8, cwd);
  const files = getChangedFiles(args.n || 8, cwd);
  const diffStat = getDiffStat(null, cwd);

  const prompt = buildSummarizePrompt({ commits, files, diffStat });
  let parsed;
  try {
    parsed = JSON.parse(await callAI(prompt, args.aiApiKey, args.aiBaseUrl));
  } catch (e) {
    return ok({ ok: false, msg: e.message });
  }

  const entry = saveContext({ ...parsed, branch: getCurrentBranch(cwd) }, cwd);
  return ok({
    ok: true,
    id: entry.id,
    tokens: entry.tokenCount,
    summary: parsed,
  });
}

async function handleSuggest(args) {
  const cwd = args.cwd || process.cwd();
  const branch = getCurrentBranch(cwd);
  const entry = loadLatest(branch, cwd);
  if (!entry)
    return ok({ ok: false, msg: "No context found. Run devctx_save first." });

  const prompt = buildSuggestPrompt(entry);
  let parsed;
  try {
    parsed = JSON.parse(await callAI(prompt, args.aiApiKey, args.aiBaseUrl));
  } catch (e) {
    return ok({ ok: false, msg: e.message });
  }
  return ok({
    ok: true,
    task: entry.task,
    suggestions: parsed.nextSteps || parsed,
  });
}

async function handleConfigSet(args) {
  const cwd = args.cwd || process.cwd();
  if (!isInitialized(cwd)) return ok({ ok: false, msg: "Not initialized." });
  const cfg = loadConfig(cwd);
  cfg[args.key] = args.value;
  saveConfig(cfg, cwd);
  return ok({ ok: true, key: args.key, value: args.value });
}

async function handleConfigList(args) {
  const cwd = args.cwd || process.cwd();
  const cfg = loadConfig(cwd);
  return ok(cfg || { error: "Not initialized." });
}

export const handlers = {
  readResource: async (req) => {
    const { uri } = req.params;
    const cwd = process.cwd();
    const branch = getCurrentBranch(cwd);
    const entry = loadLatest(branch, cwd);

    if (!entry)
      return {
        contents: [
          {
            uri,
            mimeType: "text/plain",
            text: `No context for branch '${branch}'. Run devctx_save.`,
          },
        ],
      };

    let text;
    if (uri === "devctx://context/full") text = buildFull(entry);
    else if (uri === "devctx://context/standard") text = buildStandard(entry);
    else text = buildMinimal(entry);

    return { contents: [{ uri, mimeType: "text/plain", text }] };
  },
  callTool: async (req) => {
    const { name, arguments: args = {} } = req.params;
    try {
      switch (name) {
        case "devctx_save":
          return await handleSave(args);
        case "devctx_resume":
          return await handleResume(args);
        case "devctx_log":
          return await handleLog(args);
        case "devctx_diff":
          return await handleDiff(args);
        case "devctx_handoff":
          return await handleHandoff(args);
        case "devctx_share":
          return await handleShare(args);
        case "devctx_summarize":
          return await handleSummarize(args);
        case "devctx_suggest":
          return await handleSuggest(args);
        case "devctx_init":
          return await handleInit(args);
        case "devctx_config_set":
          return await handleConfigSet(args);
        case "devctx_config_list":
          return await handleConfigList(args);
        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown: ${name}`);
      }
    } catch (e) {
      if (e instanceof McpError) throw e;
      throw new McpError(ErrorCode.InternalError, e.message);
    }
  },
};

export const toolsList = [
  {
    name: "devctx_save",
    description:
      "Save AI coding context for current branch. Call at end of session or after key decisions. Token-efficient storage.",
    inputSchema: {
      type: "object",
      required: ["task"],
      properties: {
        task: {
          type: "string",
          description: "What are you working on? One clear sentence.",
        },
        goal: {
          type: "string",
          description: "Why? What problem does it solve?",
        },
        state: {
          type: "string",
          description:
            "Current state — what's done, what's in-progress, what's broken.",
        },
        approaches: {
          type: "array",
          description:
            "Approaches tried. IMPORTANT: Mark failed ones with failed:true and reason to prevent AI re-suggesting them.",
          items: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                required: ["description"],
                properties: {
                  description: { type: "string" },
                  failed: { type: "boolean" },
                  reason: { type: "string" },
                },
              },
            ],
          },
        },
        decisions: {
          type: "array",
          items: { type: "string" },
          description: "Key decisions made (architectural, tech choices).",
        },
        nextSteps: {
          type: "array",
          items: { type: "string" },
          description: "Ordered next actions. Most important first.",
        },
        constraints: {
          type: "array",
          items: { type: "string" },
          description: "Hard limits AI must respect in future sessions.",
        },
        filesChanged: {
          type: "array",
          items: { type: "string" },
          description: "Key files in scope. Auto-detected from git if omitted.",
        },
        cwd: {
          type: "string",
          description: "Repo path. Defaults to process.cwd().",
        },
      },
    },
  },
  {
    name: "devctx_resume",
    description:
      "Restore context for the current branch. Returns a structured prompt. Use tier='minimal' (~80 tokens) for quick orientation, 'standard' (~250 tokens) for starting a session, 'full' (~600 tokens) for handoffs.",
    inputSchema: {
      type: "object",
      properties: {
        branch: {
          type: "string",
          description: "Branch to restore. Defaults to current branch.",
        },
        id: { type: "string", description: "Restore a specific entry by ID." },
        tier: {
          type: "string",
          enum: ["minimal", "standard", "full"],
          default: "standard",
          description: "Context detail level. Controls token usage.",
        },
        focus: {
          type: "string",
          description: "Override the action section with a specific question.",
        },
        cwd: { type: "string" },
      },
    },
  },
  {
    name: "devctx_log",
    description:
      "View context history for repo (all branches or filtered by branch).",
    inputSchema: {
      type: "object",
      properties: {
        branch: { type: "string" },
        limit: { type: "number", default: 10 },
        cwd: { type: "string" },
      },
    },
  },
  {
    name: "devctx_diff",
    description:
      "Show git changes since last context save. Useful before saving to understand what changed.",
    inputSchema: {
      type: "object",
      properties: { cwd: { type: "string" } },
    },
  },
  {
    name: "devctx_handoff",
    description:
      "Create a teammate handoff. Generates a lean context prompt scoped for the receiving developer.",
    inputSchema: {
      type: "object",
      required: ["to", "task"],
      properties: {
        to: { type: "string", description: "Teammate name or @username." },
        task: { type: "string" },
        goal: { type: "string" },
        state: { type: "string" },
        approaches: { type: "array", items: { type: "string" } },
        decisions: { type: "array", items: { type: "string" } },
        nextSteps: { type: "array", items: { type: "string" } },
        cwd: { type: "string" },
      },
    },
  },
  {
    name: "devctx_share",
    description:
      "Stage .devctx/ folder in git so teammates can pull and access context. Run after devctx_save.",
    inputSchema: { type: "object", properties: { cwd: { type: "string" } } },
  },
  {
    name: "devctx_summarize",
    description:
      "AI-powered: Auto-generate context from recent git commits + diff. Requires DEVCTX_AI_KEY env var.",
    inputSchema: {
      type: "object",
      properties: {
        n: { type: "number", default: 8, description: "Commits to analyze." },
        aiApiKey: { type: "string" },
        aiBaseUrl: {
          type: "string",
          description: "OpenAI-compatible endpoint. Defaults to OpenAI.",
        },
        cwd: { type: "string" },
      },
    },
  },
  {
    name: "devctx_suggest",
    description:
      "AI-powered: Suggest next steps based on current saved context. Requires DEVCTX_AI_KEY.",
    inputSchema: {
      type: "object",
      properties: {
        aiApiKey: { type: "string" },
        aiBaseUrl: { type: "string" },
        cwd: { type: "string" },
      },
    },
  },
  {
    name: "devctx_init",
    description:
      "Initialize DevContext in current repo. Creates .devctx/ folder. Auto-called by devctx_save if needed.",
    inputSchema: { type: "object", properties: { cwd: { type: "string" } } },
  },
  {
    name: "devctx_config_set",
    description: "Set a config value (e.g. maxEntriesPerBranch).",
    inputSchema: {
      type: "object",
      required: ["key", "value"],
      properties: {
        key: { type: "string" },
        value: {},
        cwd: { type: "string" },
      },
    },
  },
  {
    name: "devctx_config_list",
    description: "View current DevContext configuration.",
    inputSchema: { type: "object", properties: { cwd: { type: "string" } } },
  },
];

export const resourcesList = [
  {
    uri: "devctx://context",
    name: "Current Branch Context (Minimal)",
    description:
      "~80 token context snapshot for current branch. Subscribe for lightweight auto-injection.",
    mimeType: "text/plain",
  },
  {
    uri: "devctx://context/standard",
    name: "Current Branch Context (Standard)",
    description: "~250 token context. Use at session start.",
    mimeType: "text/plain",
  },
  {
    uri: "devctx://context/full",
    name: "Current Branch Context (Full)",
    description: "~600 token full context. Use for handoffs.",
    mimeType: "text/plain",
  },
];
