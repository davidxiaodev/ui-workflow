#!/usr/bin/env node
// Claude Code Stop hook. In a project with .verify/config.json it blocks the end of a turn that
// changed files of a lane (ui, api, …) when that lane is not verified for exactly the content on
// disk now:
//   - its last run-verify did not pass, or ran on a different tree (content hash, not file times);
//   - its independent review is missing, open, not approved, or names a different tree;
//   - the acceptance criteria are missing or not all accounted for in a review;
//   - the evidence pack is missing, names a different tree, or is older than a review.
// "Changed" means: the files differ from the base commit (committed on this branch or not, deletions
// included), and the tree differs from the one recorded when the turn started (turn-start.mjs), so a
// turn that only talked is not stopped.
//
// It blocks once per stop (stop_hook_active lets the second attempt through, so a turn cannot loop
// forever). UI_WORKFLOW_GATE: "enforce" (default) blocks; "observe" only logs what it would have
// blocked; "off" does nothing. Every decision is appended to .verify/gate.log.
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  acceptanceIds,
  acceptanceLines,
  changedSince,
  gitRoot,
  inLane,
  legacyConfigExists,
  loadConfig,
  OPEN_LINE,
  readJson,
  treeHash,
  workingChanges,
} from "./lib/verify-config.mjs";

const mode = (process.env.UI_WORKFLOW_GATE ?? "enforce").toLowerCase();
const input = readStdin();
if (mode === "off") process.exit(0);

const root = gitRoot(input.cwd ?? process.cwd());
if (!root) process.exit(0);

if (legacyConfigExists(root)) {
  const ui = workingChanges(root).filter((f) => /\.(tsx|jsx|vue|svelte|html|css|scss)$/.test(f));
  if (ui.length && !input.stop_hook_active) {
    block([`UI files changed (${preview(ui)}) in a project still set up for ui-workflow 0.1 (.ui-verify/).`, "Run `node <plugin>/scripts/run-verify.mjs --migrate`, follow what it prints, then verify as the skill says."]);
  }
  process.exit(0);
}

const cfg = loadConfig(root);
if (!cfg) process.exit(0);

const changes = changedSince(root, cfg.base);
const required = cfg.lanes
  .map((lane) => ({ lane, files: changes.filter((c) => inLane(lane, c.path)).map((c) => c.path) }))
  .filter((x) => x.files.length);
if (required.length === 0) process.exit(0);

const current = treeHash(root);
const turn = readJson(join(cfg.dir, "turn.json"));
if (current && turn?.tree === current) process.exit(0); // this turn changed nothing

const last = readJson(join(cfg.dir, "last-run.json"));
const problems = [];
const reviewTimes = [];
const coveredIds = new Set();
const short = (h) => (h ? h.slice(0, 12) : "none");

if (!current) problems.push("could not hash the working tree (git failed); verification cannot be matched to the content.");

for (const { lane, files } of required) {
  const run = last?.lanes?.[lane.name];
  const reviewPath = join(cfg.dir, `review-${lane.name}.md`);
  const label = `lane ${lane.name} (${preview(files)})`;
  if (!run) {
    problems.push(`${label}: run-verify has not run this lane.`);
    continue;
  }
  if (run.result !== "pass") problems.push(`${label}: the last run-verify result is "${run.result}", not "pass".`);
  if (run.tree !== current) problems.push(`${label}: files changed since the last run-verify (it checked tree ${short(run.tree)}, the tree is now ${short(current)}).`);
  if (!existsSync(reviewPath)) {
    problems.push(`${label}: .verify/review-${lane.name}.md is missing (independent review).`);
    continue;
  }
  const review = readFileSync(reviewPath, "utf8");
  reviewTimes.push(statSync(reviewPath).mtimeMs);
  const reviewed = reviewTree(review);
  if (!reviewed) problems.push(`${label}: its review has no "Tree:" line naming the tree it reviewed (lanes.${lane.name}.tree in last-run.json).`);
  else if (current && !current.startsWith(reviewed)) problems.push(`${label}: its review is of tree ${short(reviewed)}, not the current tree ${short(current)}.`);
  const open = review.split("\n").filter(OPEN_LINE);
  if (open.length) problems.push(`${label}: its review still has ${open.length} open or failing line(s).`);
  if (!/^Verdict:\s*approved\b/im.test(review)) problems.push(`${label}: its review does not say "Verdict: approved".`);
  for (const l of acceptanceLines(review)) for (const m of l.matchAll(/\bA\d+\b/gi)) coveredIds.add(m[0].toUpperCase());
}

const acceptancePath = join(cfg.dir, "acceptance.md");
if (!existsSync(acceptancePath)) problems.push(".verify/acceptance.md is missing: write the observable criteria for this change (shared/acceptance.md).");
else {
  const ids = acceptanceIds(readFileSync(acceptancePath, "utf8"));
  if (ids.length === 0) problems.push(".verify/acceptance.md has no criteria (lines starting with `- A1`).");
  const missing = ids.filter((id) => !coveredIds.has(id));
  if (missing.length && reviewTimes.length) problems.push(`acceptance criteria ${missing.join(", ")} appear in no review's "## Acceptance" section.`);
}

const evidencePath = last?.runDir ? join(last.runDir, "evidence.md") : "";
if (!evidencePath || !existsSync(evidencePath)) problems.push("the evidence pack is missing: run make-evidence.mjs after the reviews.");
else {
  const evidenceTree = /^Tree:\s*([0-9a-f]+)/im.exec(readFileSync(evidencePath, "utf8"))?.[1];
  if (evidenceTree !== current) problems.push("the evidence pack is of another tree: run make-evidence.mjs again.");
  if (reviewTimes.some((t) => statSync(evidencePath).mtimeMs < t)) problems.push("the evidence pack is older than a review: run make-evidence.mjs again.");
}

if (problems.length === 0) {
  log("pass", []);
  process.exit(0);
}
if (input.stop_hook_active) {
  log("let-through-unverified", problems);
  process.exit(0);
}
if (mode === "observe") {
  log("would-block", problems);
  process.exit(0);
}
log("block", problems);
block([
  "Changes are not verified:",
  ...problems.map((p) => `- ${p}`),
  "Follow the lane's skill (ui: building-consistent-ui verify.md; api: building-reliable-backend verify.md): run run-verify.mjs, get an independent review written to .verify/review-<lane>.md that names the run's tree and accounts for every acceptance criterion, then run make-evidence.mjs.",
  "If you cannot verify (no browser, no database, server will not start), say so plainly to the user instead of claiming the work is done.",
]);

function reviewTree(text) {
  return /^Tree:\s*([0-9a-f]{7,40})\b/im.exec(text)?.[1] ?? null;
}

function log(decision, list) {
  try {
    appendFileSync(
      join(cfg.dir, "gate.log"),
      JSON.stringify({ at: new Date().toISOString(), mode, decision, tree: current, session: input.session_id ?? null, problems: list }) + "\n",
    );
  } catch {
    // logging never decides anything
  }
}

function block(lines) {
  process.stdout.write(JSON.stringify({ decision: "block", reason: lines.join("\n") }) + "\n");
  process.exit(0);
}

function preview(files) {
  return `${files.slice(0, 5).join(", ")}${files.length > 5 ? ", …" : ""}`;
}

function readStdin() {
  try {
    const raw = readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
