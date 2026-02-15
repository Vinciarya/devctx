/**
 * git.js — Minimal git read helpers. All read-only except stageDevctx.
 */
import { execSync } from "child_process";

function git(args, cwd = process.cwd()) {
  try { return execSync(`git ${args}`, { cwd, stdio: ["ignore","pipe","pipe"], encoding: "utf8" }).trim(); }
  catch { return null; }
}

export const getCurrentBranch = (cwd) => git("rev-parse --abbrev-ref HEAD", cwd) || "main";
export const getLatestCommit  = (cwd) => git("rev-parse HEAD", cwd);
export const isGitRepo        = (cwd) => git("rev-parse --git-dir", cwd) !== null;
export const getRemoteUrl     = (cwd) => git("remote get-url origin", cwd);
export const getGitUser       = (cwd) => {
  const name = git("config user.name", cwd);
  return name ? { name, email: git("config user.email", cwd) } : null;
};
export const getRecentCommits = (n = 8, cwd) =>
  (git(`log --oneline -n ${n}`, cwd) || "").split("\n").filter(Boolean);

export const getChangedFiles = (n = 10, cwd) =>
  [...new Set((git(`log --name-only --pretty=format: -n ${n}`, cwd) || "")
    .split("\n").map(l => l.trim()).filter(Boolean))];

export const getDiffStat = (since = null, cwd) =>
  git(since ? `diff --stat ${since}..HEAD` : "diff --stat HEAD", cwd) || "No changes.";

export const stageDevctx = (cwd) => {
  try { execSync("git add .devctx/", { cwd, stdio: "ignore" }); return true; }
  catch { return false; }
};
