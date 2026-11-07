#!/usr/bin/env node
// Builds the evidence pack a person reads instead of the code: <runDir>/evidence.md, with the merge
// tier, the acceptance criteria as the independent reviewers found them, the machine checks per lane
// (kept apart: tests passing is not the same as the requirement being met), before/after screenshots,
// recordings, the reviews' verdicts and open follow-ups. Run it after the .verify/review-<lane>.md files.
//
//   node make-evidence.mjs [--root <project root>] [--pr]
//
// --pr also prints a pull request body (text only) to stdout.
// Exit 0 always unless the inputs are missing (2).
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  acceptanceIds,
  acceptanceLines,
  contractPaths,
  gitLines,
  inLane,
  loadConfig,
  matchAny,
  OPEN_LINE,
  readJson,
  workingChanges,
} from "./lib/verify-config.mjs";

const args = process.argv.slice(2);
const rootArg = args.indexOf("--root");
const root = resolve(rootArg === -1 ? process.cwd() : args[rootArg + 1]);
const wantPr = args.includes("--pr");
const cfg = loadConfig(root);
const last = cfg && readJson(join(cfg.dir, "last-run.json"));
if (!cfg || !last?.lanes) {
  console.error("make-evidence: no .verify/last-run.json with lanes; run run-verify.mjs first.");
  process.exit(2);
}
const runDir = last.runDir;
const rel = (f) => relative(runDir, f).split("\\").join("/");

// What this change touched: uncommitted work plus commits not yet on the upstream or default branch.
const committed = gitLines(root, ["diff", "--name-only", "HEAD@{upstream}...HEAD"]);
const sinceDefault = committed.length ? [] : gitLines(root, ["diff", "--name-only", "origin/HEAD...HEAD"]);
const touched = [...new Set([...workingChanges(root), ...committed, ...sinceDefault])].filter((f) => !f.startsWith(".verify/"));

let lanes = cfg.lanes.filter((l) => touched.some((f) => inLane(l, f)));
if (lanes.length === 0) lanes = cfg.lanes.filter((l) => last.lanes[l.name]);

// Reviews, one per lane.
const reviews = lanes.map((lane) => {
  const path = join(cfg.dir, `review-${lane.name}.md`);
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = text.split("\n");
  return {
    lane,
    path,
    text,
    verdict: /^Verdict:\s*(.+)$/im.exec(text)?.[1].trim() ?? "missing",
    reviewer: /^Reviewer:\s*(.+)$/im.exec(text)?.[1].trim() ?? "not stated",
    notChecked: /^Not checked:\s*(.+)$/im.exec(text)?.[1].trim() ?? "not stated",
    open: lines.filter(OPEN_LINE),
    deferred: lines.filter((l) => /^\s*-\s*\[-\]/.test(l) && !acceptanceLines(text).includes(l)),
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
const negativeSkips = lanes.flatMap((l) => (last.lanes[l.name]?.checks ?? []).filter((c) => /no test changed/.test(c.note ?? "")).map((c) => `${l.name}/${c.name}`));
const notChecked = criteria.filter((c) => c.status === "not checked").map((c) => c.id);

const lanesReady = lanes.every((l) => last.lanes[l.name]?.result === "pass");
const reviewsReady = reviews.every((r) => /^approved\b/i.test(r.verdict) && r.open.length === 0);
const acceptanceReady = criteria.length > 0 && criteria.every((c) => c.status === "met" || c.status === "not checked");
const why2 = [
  baselineChanges.length && "screenshot baselines changed",
  sharedChanges.length && "shared parts changed",
  notChecked.length && `acceptance not checked: ${notChecked.join(", ")}`,
  negativeSkips.length && `source changed with no test change (${negativeSkips.join(", ")})`,
].filter(Boolean);
const tier = !(lanesReady && reviewsReady && acceptanceReady)
  ? { id: "not ready", rule: "Checks, reviews or acceptance did not pass. Do not merge." }
  : contractChanges.length
    ? { id: "3", rule: "A contract changed (design, API, data or migrations). The owner must confirm before merge." }
    : why2.length
      ? { id: "2", rule: `Look before merge: ${why2.join("; ")}.` }
      : { id: "1", rule: "Verified and contained. A glance at this page is enough to merge." };

// Screenshots from the ui lanes' run folders.
const uiDirs = [...new Set(lanes.filter((l) => l.kind === "ui").map((l) => last.lanes[l.name]?.runDir).filter(Boolean))];
const changedNow = workingChanges(root);
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
md.push(`- Lanes: ${lanes.map((l) => l.name).join(", ") || "none"}`);
for (const r of reviews) md.push(`- Review ${r.lane.name}: ${r.verdict}, by ${r.reviewer}; ${r.open.length} open, ${r.deferred.length} deferred`);
md.push(`- Contract changes: ${list(contractChanges)}`);
md.push(`- Baselines changed: ${list(baselineChanges)}`);
md.push(`- Shared parts changed: ${list(sharedChanges)}`);
for (const r of reviews) md.push(`- Not checked (${r.lane.name}): ${r.notChecked}`);
md.push("");
md.push("## Acceptance: verified by the independent reviewers", "");
if (criteria.length === 0) md.push("- no .verify/acceptance.md criteria", "");
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
  for (const c of run.checks) md.push(`  - ${c.name}: ${c.exitCode === 0 ? "pass" : `FAIL (exit ${c.exitCode})`}${c.note ? ` · ${c.note}` : ""} · [log](${rel(c.log)})`);
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

const evidencePath = join(runDir, "evidence.md");
writeFileSync(evidencePath, md.join("\n"));
console.error(`make-evidence: ${evidencePath} (tier ${tier.id}, ${criteria.length} criteria, ${pages.size} page(s), ${recordings.length} recording(s))`);

if (wantPr) {
  const deferred = reviews.flatMap((r) => r.deferred.map((d) => `  ${d.trim()} (${r.lane.name})`));
  const pr = [
    "## Evidence",
    "",
    `**Merge tier: ${tier.id}.** ${tier.rule}`,
    "",
    "### Acceptance (independently verified)",
    ...(criteria.length ? criteria.map((c) => `- ${c.status === "met" ? "[x]" : c.status === "not checked" ? "[-]" : "[ ]"} ${c.id} ${c.text} — ${c.status}`) : ["- none"]),
    "",
    "### Checks",
    ...lanes.map((l) => `- ${l.name}: ${last.lanes[l.name]?.result ?? "not run"}; review: ${reviews.find((r) => r.lane === l)?.verdict} (${reviews.find((r) => r.lane === l)?.reviewer})`),
    `- Contract changes: ${list(contractChanges)}`,
    `- Baselines changed: ${list(baselineChanges)}`,
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
    const bytes = execFileSync("git", ["show", `HEAD:${relPath}`], { cwd: root, maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] });
    writeFileSync(out, bytes);
    return out;
  } catch {
    if (!changedNow.includes(relPath)) {
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
