/**
 * prompts.js — Tiered, token-efficient prompt generation
 *
 * THREE TIERS — use the smallest one that answers the question:
 *
 * MINIMAL  (~80 tokens)  — task + state + next step. For "what are we doing?"
 * STANDARD (~250 tokens) — + decisions + failed approaches. For starting a session.
 * FULL     (~600 tokens) — Everything. For complex handoffs or deep dives.
 *
 * KEY INSIGHT: Most editors inject the resume prompt into every message.
 * A 600-token prompt injected 20 times = 12,000 wasted tokens per session.
 * A 80-token minimal prompt injected 20 times = 1,600 tokens. 87% saving.
 */

import { TIER, trimTobudget } from "./tokens.js";

/**
 * Core builder — produces a structured prompt for a given tier.
 * Lean sections only. No fluff, no markdown headers with emojis.
 */
export function buildPrompt(entry, tier = TIER.STANDARD, focusQuestion = null) {
  const e = trimTobudget(entry, tier.budget);
  const parts = [];

  // Role line — one sentence, not a paragraph
  parts.push(`You are pair-programming on: ${e.task}`);

  if (e.goal) parts.push(`Why: ${e.goal}`);
  if (e.state) parts.push(`State: ${e.state}`);

  if (e.constraints?.length) {
    parts.push(`Constraints: ${e.constraints.join(" | ")}`);
  }

  if (e.decisions?.length) {
    parts.push(`Settled decisions (don't relitigate): ${e.decisions.join(" | ")}`);
  }

  // Failed approaches — most token-efficient way to prevent AI re-suggesting them
  const failed = (e.approaches || []).filter(a => typeof a === "object" && a.failed);
  if (failed.length) {
    const failedStr = failed.map(a => `${a.description}${a.reason ? ` (${a.reason})` : ""}`).join(" | ");
    parts.push(`Already failed — do NOT suggest: ${failedStr}`);
  }

  if (e.nextSteps?.length) {
    parts.push(`Next: ${e.nextSteps[0]}`);
    if (e.nextSteps.length > 1 && tier !== TIER.MINIMAL) {
      parts.push(`Backlog: ${e.nextSteps.slice(1).join(" | ")}`);
    }
  }

  parts.push(`Branch: ${entry.branch} | Saved: ${entry.timestamp?.slice(0, 10)}`);

  if (focusQuestion) {
    parts.push(`\nFocus: ${focusQuestion}`);
  } else if (e.nextSteps?.length) {
    parts.push(`\nContinue from next step. Ask clarifying questions if needed.`);
  } else {
    parts.push(`\nConfirm you understand the context, then ask what to work on.`);
  }

  return parts.join("\n");
}

/** Minimal prompt — just enough to orient the AI. ~80 tokens. */
export function buildMinimal(entry, focusQuestion = null) {
  return buildPrompt(entry, TIER.MINIMAL, focusQuestion);
}

/** Standard prompt — for starting a fresh coding session. ~250 tokens. */
export function buildStandard(entry, focusQuestion = null) {
  return buildPrompt(entry, TIER.STANDARD, focusQuestion);
}

/** Full prompt — for handoffs or returning after a long break. ~600 tokens. */
export function buildFull(entry, focusQuestion = null) {
  return buildPrompt(entry, TIER.FULL, focusQuestion);
}

/** Handoff prompt — peer-to-peer knowledge transfer. */
export function buildHandoff(entry, fromUser, toUser) {
  const e = trimTobudget(entry, TIER.FULL.budget);
  const parts = [
    `HANDOFF: ${fromUser} → ${toUser}`,
    `Task: ${e.task}`,
  ];
  if (e.goal) parts.push(`Why: ${e.goal}`);
  if (e.state) parts.push(`Where we left off: ${e.state}`);
  if (e.decisions?.length) parts.push(`Settled (don't re-debate): ${e.decisions.join(" | ")}`);

  const failed = (e.approaches || []).filter(a => typeof a === "object" && a.failed);
  if (failed.length) {
    parts.push(`These failed: ${failed.map(a => a.description).join(" | ")}`);
  }

  if (e.nextSteps?.length) {
    parts.push(`Your first move: ${e.nextSteps[0]}`);
    if (e.nextSteps.length > 1) parts.push(`Then: ${e.nextSteps.slice(1).join(" | ")}`);
  }
  parts.push(`Branch: ${entry.branch}`);
  return parts.join("\n");
}

/** Summarize prompt — sent to AI to auto-extract context from git data. */
export function buildSummarizePrompt(gitData) {
  return `Extract coding context from this git data as JSON only (no markdown):
Commits: ${gitData.commits?.slice(0, 8).join(" | ") || "none"}
Files: ${gitData.files?.slice(0, 10).join(", ") || "none"}
Diff stats: ${gitData.diffStat || "none"}

Return ONLY this JSON shape:
{"task":"one-line description","goal":"why","state":"current state","decisions":[],"nextSteps":[],"filesChanged":[]}`;
}

/** Suggest prompt — AI recommends next steps. Kept tight. */
export function buildSuggestPrompt(entry) {
  return `Given this coding context, suggest 3 next steps as JSON only:
Task: ${entry.task}
State: ${entry.state || "unknown"}
Decisions: ${(entry.decisions || []).join(" | ") || "none"}

Return ONLY: {"nextSteps":[{"step":"...","priority":"high|medium|low","why":"..."}]}`;
}
