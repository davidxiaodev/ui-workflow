#!/usr/bin/env node
// Claude Code Stop hook. In a project that uses ui-workflow (docs/design.md and
// .ui-verify/config.json both exist), it blocks the end of a turn when UI files changed
// after the last passing run-verify, or after the last review.
// Set UI_WORKFLOW_GATE=off in the environment to disable it.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const input = readStdin();
if (process.env.UI_WORKFLOW_GATE === "off" || input.stop_hook_active) process.exit(0);

const root = gitRoot(input.cwd ?? process.cwd());
if (!root) process.exit(0);
if (!existsSync(join(root, "docs", "design.md")) || !existsSync(join(root, ".ui-verify", "config.json"))) process.exit(0);

const UI_FILE = /\.(tsx|jsx|vue|svelte|html|css|scss)$/;
const NOT_UI = /(^|\/)(\.ui-verify|e2e|tests?|__tests__|[^/]*-snapshots)\/|\.(test|spec|e2e|stories)\.[cm]?[jt]sx?$/;

const changed = git(root, ["status", "--porcelain", "--untracked-files=all"])
  .split("\n")
  .filter(Boolean)
  .map((l) => l.slice(3).split(" -> ").pop())
  .filter((f) => UI_FILE.test(f) && !NOT_UI.test(f))
  .filter((f) => existsSync(join(root, f)));
if (changed.length === 0) process.exit(0);

const newest = Math.max(...changed.map((f) => statSync(join(root, f)).mtimeMs));
const lastRunPath = join(root, ".ui-verify", "last-run.json");
const reviewPath = join(root, ".ui-verify", "review.md");
const problems = [];

if (!existsSync(lastRunPath)) {
  problems.push("run-verify has never run in this project.");
} else {
  const last = JSON.parse(readFileSync(lastRunPath, "utf8"));
  const finished = Date.parse(last.finishedAt);
  if (last.result !== "pass") problems.push(`the last run-verify result is "${last.result}", not "pass".`);
  if (finished < newest) problems.push("UI files changed after the last run-verify.");
  if (!existsSync(reviewPath)) problems.push(".ui-verify/review.md is missing.");
  else {
    if (statSync(reviewPath).mtimeMs < finished) problems.push(".ui-verify/review.md is older than the last run-verify.");
    const open = readFileSync(reviewPath, "utf8").split("\n").filter((l) => /^\s*-\s*\[ \]/.test(l) || /^\s*(?:-\s*)?FAIL\b/.test(l));
    if (open.length) problems.push(`.ui-verify/review.md still has ${open.length} open or failing line(s).`);
    if (!/^Verdict:\s*approved\b/im.test(readFileSync(reviewPath, "utf8"))) problems.push('.ui-verify/review.md does not say "Verdict: approved".');
  }
  const evidencePath = last.runDir ? join(last.runDir, "evidence.md") : "";
  if (!evidencePath || !existsSync(evidencePath)) problems.push("the evidence pack is missing: run make-evidence.mjs after the review.");
  else if (existsSync(reviewPath) && statSync(evidencePath).mtimeMs < statSync(reviewPath).mtimeMs) problems.push("the evidence pack is older than the review: run make-evidence.mjs again.");
}

if (problems.length === 0) process.exit(0);
const reason = [
  `UI files changed (${changed.slice(0, 5).join(", ")}${changed.length > 5 ? ", …" : ""}) but the UI is not verified:`,
  ...problems.map((p) => `- ${p}`),
  "Follow the building-consistent-ui skill's verify.md: run run-verify.mjs, review the screenshots with design-review.md, write .ui-verify/review.md, then run make-evidence.mjs.",
  "If you cannot verify (no browser, server will not start), say so plainly to the user instead of claiming the work is done.",
].join("\n");
process.stdout.write(JSON.stringify({ decision: "block", reason }) + "\n");
process.exit(0);

function readStdin() {
  try {
    const raw = readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function git(cwd, argv) {
  return execFileSync("git", argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

function gitRoot(cwd) {
  try {
    return git(cwd, ["rev-parse", "--show-toplevel"]).trim();
  } catch {
    return null;
  }
}
