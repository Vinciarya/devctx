/**
 * tokens.js — Token counting & budget management
 *
 * Approximation: 1 token ≈ 4 chars (OpenAI/Anthropic rule of thumb).
 * Accurate enough for budgeting. No tiktoken dependency needed.
 */

export const TIER = {
  MINIMAL:  { name: "minimal",  budget: 80  },  // Just task + state + 1 next step
  STANDARD: { name: "standard", budget: 250 },  // + decisions + failed approaches
  FULL:     { name: "full",     budget: 600 },  // Everything
};

/** Estimate token count for a string */
export function countTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/** Count tokens for an entire context entry object */
export function countEntryTokens(entry) {
  const parts = [
    entry.task,
    entry.goal,
    entry.state,
    ...(entry.decisions || []),
    ...(entry.nextSteps || []),
    ...(entry.constraints || []),
    ...(entry.approaches || []).map(a => typeof a === "object" ? `${a.description} ${a.reason || ""}` : a),
    ...(entry.filesChanged || []),
  ];
  return parts.reduce((sum, p) => sum + countTokens(p), 0);
}

/**
 * Trim an entry to fit within a token budget.
 * Returns a shallow copy with truncated arrays — never mutates original.
 */
export function trimTobudget(entry, budget) {
  const trimmed = { ...entry };
  let used = countTokens(trimmed.task) + countTokens(trimmed.state);

  // Goal
  if (used + countTokens(trimmed.goal) <= budget) {
    used += countTokens(trimmed.goal);
  } else {
    trimmed.goal = null;
  }

  // Next steps — keep as many as fit
  trimmed.nextSteps = [];
  for (const step of (entry.nextSteps || [])) {
    const t = countTokens(step);
    if (used + t <= budget) { trimmed.nextSteps.push(step); used += t; }
    else break;
  }

  // Decisions
  trimmed.decisions = [];
  for (const d of (entry.decisions || [])) {
    const t = countTokens(d);
    if (used + t <= budget) { trimmed.decisions.push(d); used += t; }
    else break;
  }

  // Failed approaches only (most valuable for avoiding mistakes)
  trimmed.approaches = [];
  const failed = (entry.approaches || []).filter(a => typeof a === "object" && a.failed);
  for (const a of failed) {
    const t = countTokens(a.description) + countTokens(a.reason);
    if (used + t <= budget) { trimmed.approaches.push(a); used += t; }
    else break;
  }

  // Constraints
  trimmed.constraints = [];
  for (const c of (entry.constraints || [])) {
    const t = countTokens(c);
    if (used + t <= budget) { trimmed.constraints.push(c); used += t; }
    else break;
  }

  trimmed._tokenCount = used;
  trimmed._tier = budget <= TIER.MINIMAL.budget ? "minimal" : budget <= TIER.STANDARD.budget ? "standard" : "full";
  return trimmed;
}
