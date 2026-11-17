#!/usr/bin/env node
// Writes the brief for an independent reviewer of one lane, so every review gets the same inputs:
// what to read, the tree under review, how deep to go, the checklist items this diff triggers, and,
// from the second round on, the previous round's findings and only the diff since then.
//
//   node review-brief.mjs --lane api --request "<the user's words>" [--root <dir>]
//   node review-brief.mjs --lane ui --request "…" --scope "<pages and widths>" --baselines "<page-width: why, or none>"
//
// Prints the brief (pass it verbatim to a fresh subagent) and saves it to .verify/brief-<lane>.md.
// Exit 0 with a brief; 3 when three rounds ran without approval (stop and hand the findings to the
// user); 2 when inputs are missing (no run of this lane on the current tree).
//
// Rounds: a review of an older tree is archived to .verify/rounds/<lane>-<n>.md when the next brief is
// written. The count restarts when .verify/acceptance.md changes (a new change).
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CHECKLIST_PATH, matchChecklist, parseChecklist } from "./lib/checklist.mjs";
import { changedSince, contractPaths, gitLines, gitShow, guardChanges, inLane, loadConfig, matchAny, OPEN_LINE, readJson, treeHash } from "./lib/verify-config.mjs";

const MAX_ROUNDS = 3;
const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const root = resolve(opt("root") ?? process.cwd());
const laneName = opt("lane");
const request = opt("request") ?? "<the user's request, in their words>";

const cfg = loadConfig(root);
if (!cfg) fail(2, "review-brief: no .verify/config.json.");
const lane = cfg.lanes.find((l) => l.name === laneName);
if (!lane) fail(2, `review-brief: --lane must be one of ${cfg.lanes.map((l) => l.name).join(", ")}.`);

const current = treeHash(root);
const last = readJson(join(cfg.dir, "last-run.json"));
const run = last?.lanes?.[lane.name];
if (!run || run.tree !== current || run.result !== "pass") {
  fail(2, `review-brief: run-verify has not passed lane ${lane.name} on the current tree; run it first (the reviewer reviews what the checks passed).`);
}

// What changed, for this lane.
const changes = changedSince(root, cfg.base).filter((c) => !c.path.startsWith(".verify/"));
const lanePaths = changes.filter((c) => inLane(lane, c.path)).map((c) => c.path);
const diffLines = gitLines(root, ["diff", "--unified=0", "--no-color", cfg.base ?? "HEAD", "--", ...(lanePaths.length ? lanePaths : ["."])]).filter(
  (l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l),
);
const untracked = new Set(gitLines(root, ["ls-files", "--others", "--exclude-standard"]));
for (const p of lanePaths.filter((p) => untracked.has(p))) {
  try {
    diffLines.push(...readFileSync(join(root, p), "utf8").split("\n").map((l) => `+${l}`));
  } catch {
    // unreadable file: path triggers still apply
  }
}
const size = diffLines.length;

// Risk: what decides depth now and the tier later.
const guarded = guardChanges(cfg, changedSince(root, cfg.base));
const contract = changes.filter((c) => matchAny(contractPaths(lane), c.path)).map((c) => c.path);
const sensitive = changes.filter((c) => matchAny(lane.sensitive ?? [], c.path)).map((c) => c.path);
const shared = changes.filter((c) => matchAny(lane.shared ?? [], c.path)).map((c) => c.path);
const reasons3 = [
  contract.length && `contract: ${contract.join(", ")}`,
  sensitive.length && `sensitive: ${sensitive.join(", ")}`,
  guarded.some((g) => g.tier === 3) && `checks changed: ${guarded.filter((g) => g.tier === 3).map((g) => g.path).join(", ")}`,
].filter(Boolean);
const depth = reasons3.length || size > 400 ? "deep" : size <= 30 && !shared.length ? "quick" : "standard";
const depthWhy = reasons3.length ? reasons3.join("; ") : size > 400 ? `${size} changed lines` : depth === "quick" ? `${size} changed lines, nothing shared` : `${size} changed lines${shared.length ? `, shared: ${shared.join(", ")}` : ""}`;

// Checklist items this diff triggers, from the base commit's checklist.
const checklistText = gitShow(root, cfg.base ?? "HEAD", CHECKLIST_PATH) ?? (existsSync(join(root, CHECKLIST_PATH)) ? readFileSync(join(root, CHECKLIST_PATH), "utf8") : "");
const items = parseChecklist(checklistText);
const matched = matchChecklist(items, { paths: lanePaths, lines: diffLines, lane: lane.name });
const broken = items.filter((i) => i.errors.length);

// Rounds.
const acceptancePath = join(cfg.dir, "acceptance.md");
const acceptanceHash = existsSync(acceptancePath) ? createHash("sha256").update(readFileSync(acceptancePath)).digest("hex").slice(0, 16) : null;
const statePath = join(cfg.dir, `rounds-${lane.name}.json`);
let state = readJson(statePath);
const reviewPath = join(cfg.dir, `review-${lane.name}.md`);
const reviewText = existsSync(reviewPath) ? readFileSync(reviewPath, "utf8") : "";
const reviewedTree = /^Tree:\s*([0-9a-f]{7,40})\b/im.exec(reviewText)?.[1] ?? null;
if (!state || state.acceptance !== acceptanceHash) {
  // A new change: a review already on disk belongs to the previous one, not to round 1 of this.
  state = { acceptance: acceptanceHash, rounds: [], ignore: reviewedTree ? [reviewedTree] : [] };
}
let previous = null;
if (reviewText && reviewedTree && !current.startsWith(reviewedTree) && !state.rounds.some((r) => r.tree === reviewedTree) && !(state.ignore ?? []).includes(reviewedTree)) {
  const n = state.rounds.length + 1;
  mkdirSync(join(cfg.dir, "rounds"), { recursive: true });
  const archived = join(cfg.dir, "rounds", `${lane.name}-${n}.md`);
  copyFileSync(reviewPath, archived);
  state.rounds.push({ n, tree: reviewedTree, verdict: /^Verdict:\s*(.+)$/im.exec(reviewText)?.[1].trim() ?? "missing", file: archived });
}
if (state.rounds.length) {
  const r = state.rounds.at(-1);
  previous = { ...r, text: readFileSync(r.file, "utf8") };
}
const round = state.rounds.length + 1;
writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
if (round > MAX_ROUNDS) {
  fail(
    3,
    `review-brief: ${MAX_ROUNDS} review rounds of lane ${lane.name} ended without approval (${state.rounds.map((r) => `round ${r.n}: ${r.verdict}`).join("; ")}). Stop, reconsider the approach, and give the user the open findings from ${previous.file}.`,
  );
}

const deferredPath = join(cfg.dir, `deferred-${lane.name}.md`);
const deferred = existsSync(deferredPath) ? readFileSync(deferredPath, "utf8").trim() : "";
const guide = join(PLUGIN, "skills", lane.kind === "ui" ? "building-consistent-ui/design-review.md" : "building-reliable-backend/code-review.md");
const contractDoc = lane.kind === "ui" ? "docs/design.md" : "docs/backend.md";

const out = [];
out.push(`Review lane ${lane.name}, round ${round} of at most ${MAX_ROUNDS}. Follow ${guide} exactly. You did not build this change.`, "");
out.push(`The user asked for: ${request}`, "");
if (opt("scope")) out.push(`Scope: ${opt("scope")}`);
if (opt("baselines")) out.push(`Baselines updated in this change (copy into the review): ${opt("baselines")}`);
if (opt("scope") || opt("baselines")) out.push("");
out.push("## Read", `- ${contractDoc}, .verify/acceptance.md, .verify/last-run.json (lanes.${lane.name}: checks, notes, logs${lane.kind === "ui" ? ", runDir screenshots" : ""})`);
if (lane.kind === "ui") out.push("- the ui-look page list (ui-pages.json) for the pages in scope");
out.push(`- the change: \`git diff ${short(cfg.base)}\` (${lanePaths.length} file(s) in this lane, ${size} changed lines)`);
const newFiles = lanePaths.filter((p) => untracked.has(p));
if (newFiles.length) out.push(`- new files not yet in git, so not in that diff (read them whole): ${newFiles.join(", ")}`);
out.push(`- Tree under review: ${current}. Write "Tree: ${current}" under the title.`, "");
out.push(`## Depth: ${depth} (${depthWhy})`);
if (depth === "quick") out.push("Mark every acceptance criterion; run only the lenses whose subject is in the diff; skip the safety fact unless a finding needs one.");
if (depth === "standard") out.push("Mark every acceptance criterion; run each lens whose subject is in the diff; name and prove the safety fact for the riskiest part.");
if (depth === "deep")
  out.push(
    "Mark every acceptance criterion; run every lens; prove the safety fact by running something. Before you write a Blocker, try to disprove it: find the code path, test or guard that would make it harmless, and run the input that shows it. Keep it only if it survives, and say how you checked.",
  );
out.push("");
out.push("## Checklist items this change triggers (docs/checklist.md)");
if (matched.length) for (const i of matched) out.push(`- ${i.id} ${i.title} · triggered by ${i.why.join(", ")}`, `  check: ${i.check || "(no check written)"}`, `  source: ${i.source || "(none)"}`);
else out.push(items.length ? "- none triggered" : "- the project has no checklist yet");
out.push("Mark each one under `## Checklist` in the review: `- [x] C<n> holds · <evidence>` or `- [ ] C<n> broken · <what you saw>` (an open line blocks).", "");
if (previous) {
  out.push(`## Round ${round}: what changed since round ${previous.n}`);
  out.push(`- Round ${previous.n} reviewed tree ${short(previous.tree)} and said: ${previous.verdict}. Its review: ${previous.file}`);
  out.push(`- Read only the new diff: \`git diff ${previous.tree} ${current}\`. Do not re-read unchanged code for new findings.`);
  out.push("- For every finding of that round, carry it over: `fixed` (say how you saw it), `still open` (keep it `- [ ]`), or deferred (`- [-]`). Do not post a finding again in other words.");
  out.push("- New findings only in lines this round changed, or bugs those lines introduced elsewhere.", "");
  const carried = previous.text.split("\n").filter((l) => OPEN_LINE(l) || /^\s*-\s*\[-\]/.test(l));
  if (carried.length) out.push("Round findings to carry over:", ...carried, "");
}
out.push("## Rules for findings");
out.push("- A bug in code this change did not touch is `- Pre-existing · <file:line> · <what>`: report it, it does not block, it is not the author's.");
out.push("- When a finding is one instance of a class (the same missing check in several handlers), say so and list every instance, so the author fixes the class once.");
out.push("- A finding needs a concrete failure: input → wrong output, crash, leak, lost row. Otherwise drop it.");
if (deferred) out.push("", "## Deferred by the author (record as `- [-]` if still present)", deferred);
if (broken.length) out.push("", "## Checklist items that could not be read (tell the user, as a Note)", ...broken.map((i) => `- ${i.id}: ${i.errors.join("; ")}`));
out.push("", `Write .verify/review-${lane.name}.md only. Do not edit any other file. Reply with the verdict and the Blocker lines.`);

const text = out.join("\n") + "\n";
writeFileSync(join(cfg.dir, `brief-${lane.name}.md`), text);
process.stdout.write(text);

function short(h) {
  return h ? h.slice(0, 12) : "none";
}

function fail(code, message) {
  console.error(message);
  process.exit(code);
}
