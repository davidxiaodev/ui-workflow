#!/usr/bin/env node
// Builds the evidence pack a person reads instead of the code: <runDir>/evidence.md, with the merge
// tier, the acceptance criteria as the independent reviewers found them, the machine checks per lane
// (kept apart: tests passing is not the same as the requirement being met), before/after screenshots,
// recordings, the reviews' verdicts and open follow-ups. Run it after the .verify/review-<lane>.md files.
//
//   node make-evidence.mjs [--root <project root>] [--pr]
//
// --pr also prints a pull request body (text only) to stdout.
// --checks-only is for CI, where no independent review ran: the tier comes from the machine checks
// and what changed, the reviews and acceptance are left out, the pack is printed to stdout (for
// $GITHUB_STEP_SUMMARY), and --exit-code makes the exit 1 when the tier is "not ready".
//
// "The change" is everything that differs from the base commit (the merge-base with the default
// branch, or VERIFY_BASE): commits on this branch, staged, unstaged and untracked files, deletions.
// The pack names the working tree's hash; it is ready only when every lane's run and review name
// that same tree. Guarded changes (the checks themselves, deleted tests, skipped or loosened tests)
// raise the tier: lib/verify-config.mjs guardChanges.
// Exit 0 always unless the inputs are missing (2).
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  acceptanceIds,
  acceptanceLines,
  changedSince,
  contractPaths,
  gitLines,
  guardChanges,
  inLane,
  loadConfig,
  matchAny,
  OPEN_LINE,
  readJson,
  treeHash,
} from "./lib/verify-config.mjs";

const args = process.argv.slice(2);
const rootArg = args.indexOf("--root");
const root = resolve(rootArg === -1 ? process.cwd() : args[rootArg + 1]);
const wantPr = args.includes("--pr");
const checksOnly = args.includes("--checks-only");
const cfg = loadConfig(root);
const last = cfg && readJson(join(cfg.dir, "last-run.json"));
if (!cfg || !last?.lanes) {
  console.error("make-evidence: no .verify/last-run.json with lanes; run run-verify.mjs first.");
  process.exit(2);
}
const runDir = last.runDir;
const rel = (f) => relative(runDir, f).split("\\").join("/");

// What this change touched, measured from the base commit, deletions included.
const allChanges = changedSince(root, cfg.base);
const changes = allChanges.filter((c) => !c.path.startsWith(".verify/"));
const touched = changes.map((c) => c.path);
const guarded = guardChanges(cfg, allChanges); // .verify/config.json is a guard file

const current = treeHash(root);
const short = (h) => (h ? h.slice(0, 12) : "none");

let lanes = cfg.lanes.filter((l) => touched.some((f) => inLane(l, f)));
if (lanes.length === 0) lanes = cfg.lanes.filter((l) => last.lanes[l.name]);

// Reviews, one per lane.
const reviews = (checksOnly ? [] : lanes).map((lane) => {
  const path = join(cfg.dir, `review-${lane.name}.md`);
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = text.split("\n");
  return {
    lane,
    path,
    text,
    verdict: /^Verdict:\s*(.+)$/im.exec(text)?.[1].trim() ?? "missing",
    reviewer: /^Reviewer:\s*(.+)$/im.exec(text)?.[1].trim() ?? "not stated",
    tree: /^Tree:\s*([0-9a-f]{7,40})\b/im.exec(text)?.[1] ?? null,
    notChecked: /^Not checked:\s*(.+)$/im.exec(text)?.[1].trim() ?? "not stated",
    open: lines.filter(OPEN_LINE),
    deferred: lines.filter((l) => /^\s*-\s*\[-\]/.test(l) && !acceptanceLines(text).includes(l)),
    preexisting: lines.filter((l) => /^\s*-\s*Pre-existing\b/i.test(l)),
    acceptance: acceptanceLines(text),
  };
});

// Acceptance criteria and how the reviewers found each one.
const acceptancePath = join(cfg.dir, "acceptance.md");
const acceptanceText = existsSync(acceptancePath) ? readFileSync(acceptancePath, "utf8") : "";
const criteria = acceptanceIds(acceptanceText).map((id) => {
  const line = acceptanceText.split("\n").find((l) => new RegExp(`^\\s*-\\s*(?:\\[[ x-]\\]\\s*)?${id}\\b`, "i").test(l)) ?? "";
  const text = line.replace(new RegExp(`^\\s*-\\s*(?:\\[[ x-]\\]\\s*)?${id}\\b[\\s.:·-]*`, "i"), "").trim();
  const found = reviews.flatMap((r) => r.acceptance.filter((l) => new RegExp(`\\b${id}\\b`, "i").test(l)).map((l) => ({ lane: r.lane.name, line: l.trim() })));
  const status = found.length === 0 ? "not reviewed" : found.some((f) => /^-\s*\[ \]/.test(f.line)) ? "NOT MET" : found.some((f) => /^-\s*\[-\]/.test(f.line)) ? "not checked" : "met";
  return { id, text, status, found };
});

// Merge tier, computed.
const isUnder = (f, globs) => matchAny(globs, f);
const contractChanges = touched.filter((f) => lanes.some((l) => isUnder(f, contractPaths(l))));
const baselineChanges = touched.filter((f) => /-snapshots\/.+\.png$/.test(f));
const sharedChanges = touched.filter((f) => lanes.some((l) => isUnder(f, l.shared ?? [])));
const sensitiveChanges = touched.filter((f) => lanes.some((l) => isUnder(f, l.sensitive ?? [])));
// Native changes of a React Native / Expo app ship only in a new store build: native config and
// folders (lane "native"), and a package.json that gains a native module.
const nativeChanges = touched.filter((f) => lanes.some((l) => isUnder(f, l.native ?? [])));
if (lanes.some((l) => l.platform === "react-native")) {
  for (const f of touched.filter((t) => /(^|\/)package\.json$/.test(t) && !nativeChanges.includes(t))) {
    const added = gitLines(root, ["diff", "--unified=0", cfg.base ?? "HEAD", "--", f]).filter((l) => /^\+\s*"(?:react-native-|@react-native|expo-|@expo\/)[^"]*"\s*:/.test(l));
    const untracked = !added.length && !gitLines(root, ["ls-files", "--", f]).length && /"(?:react-native-|@react-native|expo-|@expo\/)[^"]*"\s*:/.test(readFileSync(join(root, f), "utf8"));
    if (added.length || untracked) nativeChanges.push(`${f} (native dependency: ${added.map((l) => l.match(/"([^"]+)"/)[1]).join(", ") || "new file"})`);
  }
}
const negativeSkips = lanes.flatMap((l) => (last.lanes[l.name]?.checks ?? []).filter((c) => /no test changed/.test(c.note ?? "")).map((c) => `${l.name}/${c.name}`));
const notChecked = criteria.filter((c) => c.status === "not checked").map((c) => c.id);

const lanesReady = lanes.every((l) => last.lanes[l.name]?.result === "pass");
const staleRuns = lanes.filter((l) => !current || last.lanes[l.name]?.tree !== current).map((l) => l.name);
const staleReviews = reviews.filter((r) => !current || !r.tree || !current.startsWith(r.tree)).map((r) => r.lane.name);
const reviewsReady = reviews.every((r) => /^approved\b/i.test(r.verdict) && r.open.length === 0);
const sameTree = staleRuns.length === 0 && staleReviews.length === 0;
const guard3 = guarded.filter((g) => g.tier === 3);
const guard2 = guarded.filter((g) => g.tier === 2);
const acceptanceReady = checksOnly || (criteria.length > 0 && criteria.every((c) => c.status === "met" || c.status === "not checked"));
const why2 = [
  baselineChanges.length && "screenshot baselines changed",
  sharedChanges.length && "shared parts changed",
  notChecked.length && `acceptance not checked: ${notChecked.join(", ")}`,
  negativeSkips.length && `source changed with no test change (${negativeSkips.join(", ")})`,
  guard2.length && `checks silenced or retried (${[...new Set(guard2.map((g) => g.path))].join(", ")})`,
].filter(Boolean);
const why3 = [
  contractChanges.length && "a contract changed (design, API, data or migrations)",
  sensitiveChanges.length && `a sensitive path changed (${sensitiveChanges.join(", ")})`,
  nativeChanges.length && `a native change needs a new store build (${nativeChanges.join(", ")})`,
  guard3.length && `the checks themselves changed (${[...new Set(guard3.map((g) => `${g.path}: ${g.why}`))].join("; ")})`,
].filter(Boolean);
const notReady = [
  !lanesReady && "a lane's checks did not pass",
  !reviewsReady && "a review is not approved or has open lines",
  !acceptanceReady && "an acceptance criterion is not met or not reviewed",
  !sameTree && `verified a different tree than the one on disk (${[...staleRuns.map((n) => `run ${n}`), ...staleReviews.map((n) => `review ${n}`)].join(", ")})`,
].filter(Boolean);
const tier = notReady.length
  ? { id: "not ready", rule: `${notReady.join("; ")}. Do not merge.` }
  : why3.length
    ? { id: "3", rule: `${why3.join("; ")}. The owner must confirm before merge.` }
    : why2.length
      ? { id: "2", rule: `Look before merge: ${why2.join("; ")}.` }
      : { id: "1", rule: "Verified and contained. A glance at this page is enough to merge." };

if (checksOnly) tier.rule = `${tier.rule} (Checks only: no independent review ran here.)`;

// Merge danger: can it be undone, and how far does it reach.
const migrationChanges = touched.filter((f) => lanes.some((l) => isUnder(f, l.migrations ?? [])));
const apiContractChanges = touched.filter((f) => lanes.some((l) => isUnder(f, l.contract ?? [])));
const field = (name) => {
  const v = new RegExp(`^${name}:\\s*(.+)$`, "im").exec(acceptanceText)?.[1].trim();
  return v && !v.startsWith("<") ? v : undefined; // an unfilled template placeholder is no answer
};
const door = migrationChanges.length
  ? `one-way: a migration changes stored data (${migrationChanges.join(", ")})`
  : nativeChanges.length
    ? "one-way: a native change ships only in a new store build, and users keep the old build until they update; JavaScript sent over the air must keep working with both"
  : apiContractChanges.length
    ? `one-way for callers already using the new contract (${apiContractChanges.join(", ")})`
    : field("Door") ?? "two-way: reverting the commit restores the previous behaviour";
const reach = [
  sensitiveChanges.length && `sensitive paths (${sensitiveChanges.length})`,
  nativeChanges.length && `native code or config (${nativeChanges.length})`,
  contractChanges.length && `contracts (${contractChanges.length})`,
  sharedChanges.length && `shared parts (${sharedChanges.length})`,
  guarded.length && `the checks (${guarded.length})`,
].filter(Boolean);
const blast = reach.length ? `wide: ${reach.join(", ")}` : `contained: ${touched.length} file(s) in ${lanes.map((l) => l.name).join(", ") || "no lane"}`;
const revert = field("Revert") ?? (migrationChanges.length ? "revert the commit and run the down migration first; check what data the up migration already changed" : "revert the commit");
const danger = [`- Door: ${door}`, `- Blast radius: ${blast}`, `- How to revert: ${revert}`];

// Screenshots from the frontend lanes' run folders.
const uiDirs = [...new Set(lanes.filter((l) => l.kind === "frontend").map((l) => last.lanes[l.name]?.runDir).filter(Boolean))];
const snapshots = walk(root, (d) => !/node_modules|\.git$|\.next$|\.verify$/.test(d)).filter((f) => /-snapshots[\\/].+\.png$/.test(f));
const pages = new Map();
for (const dir of uiDirs) {
  for (const shot of walk(dir).filter((f) => /\.png$/.test(f) && !/[\\/](before|inspect|playwright)[\\/]/.test(f))) {
    const m = /^(.*)-(\d{3,4})\.png$/.exec(basename(shot));
    if (!m) continue;
    const [, name, width] = m;
    const group = basename(dirname(shot)) === basename(dir) ? "" : basename(dirname(shot));
    const key = `${group}/${name}`;
    if (!pages.has(key)) pages.set(key, { group, name, widths: [] });
    pages.get(key).widths.push({ width: Number(width), after: shot, before: beforeImage(name, width) });
  }
}
const allRunDirs = [...new Set(lanes.map((l) => last.lanes[l.name]?.runDir).filter(Boolean))];
const recordings = allRunDirs.flatMap((d) => walk(d).filter((f) => /\.(webm|mp4|mov|gif)$/.test(f)));
const traces = allRunDirs.flatMap((d) => walk(d).filter((f) => /trace\.zip$/.test(f)));

// Keep the change's own records with the evidence (.verify/* is not committed).
for (const f of [acceptancePath, ...reviews.map((r) => r.path)]) if (existsSync(f)) copyFileSync(f, join(runDir, basename(f)));

const md = [];
md.push(`# Evidence: ${basename(runDir)}`, "");
md.push(`**Merge tier: ${tier.id}.** ${tier.rule}`, "");
md.push(`Tree: ${current ?? "unknown"}`, `Base: ${cfg.base ?? "none"}`, "");
md.push(`- Lanes: ${lanes.map((l) => l.name).join(", ") || "none"}`);
for (const r of reviews) md.push(`- Review ${r.lane.name}: ${r.verdict}, by ${r.reviewer}; ${r.open.length} open, ${r.deferred.length} deferred`);
md.push(`- Contract changes: ${list(contractChanges)}`);
md.push(`- Check changes: ${guarded.length ? guarded.map((g) => `${g.path} (${g.why}, tier ${g.tier})`).join(", ") : "none"}`);
md.push(`- Checks read from: ${last.config?.source ?? "working"} config${last.config?.differsFromBase ? " (the working .verify/config.json differs from base)" : ""}`);
md.push(`- Baselines changed: ${list(baselineChanges)}`);
md.push(`- Shared parts changed: ${list(sharedChanges)}`);
for (const r of reviews) md.push(`- Not checked (${r.lane.name}): ${r.notChecked}`);
md.push("");
md.push("## Merge danger", "", ...danger, "");
md.push("## Acceptance: verified by the independent reviewers", "");
if (checksOnly) md.push("- not part of a checks-only run", "");
else if (criteria.length === 0) md.push("- no .verify/acceptance.md criteria", "");
else {
  md.push("| Id | Criterion | Status | Reviewer's evidence |", "| --- | --- | --- | --- |");
  for (const c of criteria) md.push(`| ${c.id} | ${cell(c.text)} | ${c.status} | ${cell(c.found.map((f) => `${f.lane}: ${f.line.replace(/^-\s*\[[ x-]\]\s*/, "")}`).join("<br>") || "—")} |`);
  md.push("");
}
md.push("## Machine checks: the code runs and the tests pass", "");
for (const l of lanes) {
  const run = last.lanes[l.name];
  if (!run) {
    md.push(`- ${l.name}: not run`);
    continue;
  }
  md.push(`- **${l.name}: ${run.result}** (${run.finishedAt})`);
  for (const c of run.checks) md.push(`  - ${c.name}: ${c.skipped ? "skipped" : c.exitCode === 0 ? "pass" : `FAIL (exit ${c.exitCode})`}${c.note ? ` · ${c.note}` : ""}${c.log ? ` · [log](${rel(c.log)})` : ""}`);
}
md.push("");
if (pages.size) {
  md.push("## Pages", "");
  for (const p of [...pages.values()].sort((a, b) => (a.group + a.name).localeCompare(b.group + b.name))) {
    md.push(`### ${p.group ? `${p.group} / ` : ""}${p.name}`, "", "| Width | Before (baseline) | After |", "| --- | --- | --- |");
    for (const w of p.widths.sort((a, b) => a.width - b.width)) {
      const before = w.before ? `![before](${rel(w.before)})` : "new page, no baseline";
      md.push(`| ${w.width} | ${before} | ![after](${rel(w.after)}) |`);
    }
    md.push("");
  }
}
if (uiDirs.length || recordings.length) {
  md.push("## Recordings", "", ...(recordings.length ? recordings.map((r) => `- [${rel(r)}](${rel(r)})`) : ["- none (enable video in the Playwright config, startRecording in Maestro flows)"]), "");
}
if (traces.length) md.push("## Traces", "", ...traces.map((t) => `- [${rel(t)}](${rel(t)}) (open with \`npx playwright show-trace\`)`), "");
const findings = reviews.flatMap((r) => [...r.open, ...r.deferred].map((l) => `${l} (${r.lane.name})`));
md.push("## Open and deferred findings", "", ...(findings.length ? findings : ["- none"]), "");
const preexisting = reviews.flatMap((r) => r.preexisting.map((l) => `${l} (${r.lane.name})`));
if (preexisting.length) md.push("## Pre-existing problems found on the way (not this change's; file them)", "", ...preexisting, "");

const evidencePath = join(runDir, "evidence.md");
writeFileSync(evidencePath, md.join("\n"));
console.error(`make-evidence: ${evidencePath} (tier ${tier.id}, ${criteria.length} criteria, ${pages.size} page(s), ${recordings.length} recording(s))`);

if (checksOnly) {
  process.stdout.write(md.join("\n") + "\n");
  if (args.includes("--exit-code") && tier.id === "not ready") process.exit(1);
}

if (wantPr) {
  const deferred = reviews.flatMap((r) => r.deferred.map((d) => `  ${d.trim()} (${r.lane.name})`));
  const pr = [
    "## Evidence",
    "",
    `**Merge tier: ${tier.id}.** ${tier.rule}`,
    "",
    "### Merge danger",
    ...danger,
    "",
    "### Acceptance (independently verified)",
    ...(criteria.length ? criteria.map((c) => `- ${c.status === "met" ? "[x]" : c.status === "not checked" ? "[-]" : "[ ]"} ${c.id} ${c.text} — ${c.status}`) : ["- none"]),
    "",
    "### Checks",
    ...lanes.map((l) => `- ${l.name}: ${last.lanes[l.name]?.result ?? "not run"}; review: ${reviews.find((r) => r.lane === l)?.verdict} (${reviews.find((r) => r.lane === l)?.reviewer})`),
    `- Contract changes: ${list(contractChanges)}`,
    `- Check changes: ${guarded.length ? guarded.map((g) => `${g.path} (${g.why})`).join(", ") : "none"}`,
    `- Baselines changed: ${list(baselineChanges)}`,
    `- Verified tree: \`${short(current)}\` against base \`${short(cfg.base)}\``,
    ...(pages.size ? [`- Pages verified: ${[...pages.values()].map((p) => `${p.name} (${p.widths.map((w) => w.width).join("/")})`).join(", ")}`] : []),
    `- Deferred follow-ups: ${deferred.length ? "" : "none"}`,
    ...deferred,
    ...reviews.map((r) => `- Not checked (${r.lane.name}): ${r.notChecked}`),
    "",
    "Logs, screenshots and recordings: attach them from the run folder, or the CI artifact of this run.",
  ];
  process.stdout.write(pr.join("\n") + "\n");
}

function beforeImage(name, width) {
  const match = snapshots.find((s) => basename(s).startsWith(`${name}-${width}`));
  if (!match) return null;
  const relPath = relative(root, match).split("\\").join("/");
  const out = join(runDir, "before", basename(match));
  mkdirSync(dirname(out), { recursive: true });
  try {
    const bytes = execFileSync("git", ["show", `${cfg.base ?? "HEAD"}:${relPath}`], { cwd: root, maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] });
    writeFileSync(out, bytes);
    return out;
  } catch {
    if (!touched.includes(relPath)) {
      copyFileSync(match, out);
      return out;
    }
    return null;
  }
}

function walk(dir, keepDir = () => true) {
  if (!dir || !existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (e === "node_modules" || !keepDir(p)) continue;
      out.push(...walk(p, keepDir));
    } else out.push(p);
  }
  return out;
}

function list(items) {
  return items.length ? items.map((i) => `\`${i}\``).join(", ") : "none";
}

function cell(s) {
  return s.replace(/\|/g, "\\|");
}
