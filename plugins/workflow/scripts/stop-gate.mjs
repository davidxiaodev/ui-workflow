#!/usr/bin/env node
// Claude Code Stop hook. In a project with .verify/config.json it blocks the end of a turn when
// files of a lane (ui, api, …) changed and that lane is not verified: its last run-verify did not
// pass after the change, its independent review is missing, stale, open or not approved, the
// acceptance criteria are missing or not all accounted for in a review, or the evidence pack is
// older than the reviews. It blocks once per stop (stop_hook_active lets the second attempt through,
// so a turn cannot loop forever). Set UI_WORKFLOW_GATE=off to disable it.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  acceptanceIds,
  acceptanceLines,
  gitRoot,
  inLane,
  legacyConfigExists,
  loadConfig,
  OPEN_LINE,
  readJson,
  workingChanges,
} from "./lib/verify-config.mjs";

const input = readStdin();
if (process.env.UI_WORKFLOW_GATE === "off" || input.stop_hook_active) process.exit(0);

const root = gitRoot(input.cwd ?? process.cwd());
if (!root) process.exit(0);

const changed = workingChanges(root);
if (legacyConfigExists(root)) {
  const ui = changed.filter((f) => /\.(tsx|jsx|vue|svelte|html|css|scss)$/.test(f));
  if (ui.length) block([`UI files changed (${preview(ui)}) in a project still set up for ui-workflow 0.1 (.ui-verify/).`, "Run `node <plugin>/scripts/run-verify.mjs --migrate`, follow what it prints, then verify as the skill says."]);
  process.exit(0);
}

const cfg = loadConfig(root);
if (!cfg) process.exit(0);

const required = cfg.lanes
  .map((lane) => ({ lane, files: changed.filter((f) => inLane(lane, f)) }))
  .filter((x) => x.files.length);
if (required.length === 0) process.exit(0);

const last = readJson(join(cfg.dir, "last-run.json"));
const problems = [];
const reviewTimes = [];
const coveredIds = new Set();

for (const { lane, files } of required) {
  const newest = Math.max(...files.map((f) => statSync(join(root, f)).mtimeMs));
  const run = last?.lanes?.[lane.name];
  const reviewPath = join(cfg.dir, `review-${lane.name}.md`);
  const label = `lane ${lane.name} (${preview(files)})`;
  if (!run) {
    problems.push(`${label}: run-verify has not run this lane.`);
    continue;
  }
  const finished = Date.parse(run.finishedAt);
  if (run.result !== "pass") problems.push(`${label}: the last run-verify result is "${run.result}", not "pass".`);
  if (finished < newest) problems.push(`${label}: files changed after the last run-verify.`);
  if (!existsSync(reviewPath)) {
    problems.push(`${label}: .verify/review-${lane.name}.md is missing (independent review).`);
    continue;
  }
  const review = readFileSync(reviewPath, "utf8");
  const reviewTime = statSync(reviewPath).mtimeMs;
  reviewTimes.push(reviewTime);
  if (reviewTime < finished) problems.push(`${label}: its review is older than the last run-verify.`);
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
else if (reviewTimes.some((t) => statSync(evidencePath).mtimeMs < t)) problems.push("the evidence pack is older than a review: run make-evidence.mjs again.");

if (problems.length === 0) process.exit(0);
block([
  "Changes are not verified:",
  ...problems.map((p) => `- ${p}`),
  "Follow the lane's skill (ui: building-consistent-ui verify.md; api: building-reliable-backend verify.md): run run-verify.mjs, get an independent review written to .verify/review-<lane>.md that accounts for every acceptance criterion, then run make-evidence.mjs.",
  "If you cannot verify (no browser, no database, server will not start), say so plainly to the user instead of claiming the work is done.",
]);

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
