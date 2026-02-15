/**
 * storage.js — Lean context persistence
 * Stores entries in .devctx/{branch}/{id}.json
 * Branch-scoped so you never accidentally load wrong context.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { countEntryTokens } from "./tokens.js";

const DIR = ".devctx";

export function devctxDir(cwd = process.cwd()) { return join(cwd, DIR); }
export function isInitialized(cwd = process.cwd()) {
  return existsSync(join(cwd, DIR, "config.json"));
}

export function initRepo(cwd = process.cwd()) {
  const dir = devctxDir(cwd);
  if (existsSync(join(dir, "config.json"))) return { created: false };
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify({
    version: "2.0.0", createdAt: new Date().toISOString(), maxEntriesPerBranch: 20
  }, null, 2));
  writeFileSync(join(dir, ".gitkeep"), "");
  // Intentionally NOT gitignoring — context should be committed
  return { created: true };
}

export function loadConfig(cwd = process.cwd()) {
  const p = join(devctxDir(cwd), "config.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

export function saveConfig(cfg, cwd = process.cwd()) {
  writeFileSync(join(devctxDir(cwd), "config.json"), JSON.stringify(cfg, null, 2));
}

/** Save a context entry. Returns the saved entry with id + tokenCount. */
export function saveContext(entry, cwd = process.cwd()) {
  if (!isInitialized(cwd)) initRepo(cwd);

  const branch = (entry.branch || "main").replace(/[^a-zA-Z0-9._-]/g, "_");
  const branchDir = join(devctxDir(cwd), "branches", branch);
  mkdirSync(branchDir, { recursive: true });

  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const full = {
    id,
    timestamp: new Date().toISOString(),
    branch: entry.branch || "main",
    task: entry.task || "",
    goal: entry.goal || null,
    state: entry.state || null,
    approaches: entry.approaches || [],
    decisions: entry.decisions || [],
    nextSteps: entry.nextSteps || [],
    constraints: entry.constraints || [],
    filesChanged: entry.filesChanged || [],
    author: entry.author || null,
    meta: entry.meta || {},
    tokenCount: 0,
  };
  full.tokenCount = countEntryTokens(full);

  writeFileSync(join(branchDir, `${id}.json`), JSON.stringify(full, null, 2));

  // Maintain index for this branch
  const indexPath = join(branchDir, "index.json");
  const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : { entries: [] };
  index.entries.unshift({ id, timestamp: full.timestamp, task: full.task, tokenCount: full.tokenCount });

  // Enforce max entries per branch
  const cfg = loadConfig(cwd);
  const max = cfg?.maxEntriesPerBranch || 20;
  index.entries = index.entries.slice(0, max);

  writeFileSync(indexPath, JSON.stringify(index, null, 2));
  return full;
}

export function loadLatest(branch, cwd = process.cwd()) {
  const branchDir = join(devctxDir(cwd), "branches", branch.replace(/[^a-zA-Z0-9._-]/g, "_"));
  const indexPath = join(branchDir, "index.json");
  if (!existsSync(indexPath)) return null;
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  if (!index.entries.length) return null;
  return loadById(index.entries[0].id, branch, cwd);
}

export function loadById(id, branch, cwd = process.cwd()) {
  const branchDir = join(devctxDir(cwd), "branches", branch.replace(/[^a-zA-Z0-9._-]/g, "_"));
  const p = join(branchDir, `${id}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

export function listEntries(branch = null, limit = 10, cwd = process.cwd()) {
  const base = join(devctxDir(cwd), "branches");
  if (!existsSync(base)) return [];

  const branches = branch
    ? [branch.replace(/[^a-zA-Z0-9._-]/g, "_")]
    : readdirSync(base).filter(d => existsSync(join(base, d, "index.json")));

  const all = [];
  for (const b of branches) {
    const idx = join(base, b, "index.json");
    if (!existsSync(idx)) continue;
    const { entries } = JSON.parse(readFileSync(idx, "utf8"));
    entries.forEach(e => all.push({ ...e, branch: b }));
  }

  return all.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);
}
