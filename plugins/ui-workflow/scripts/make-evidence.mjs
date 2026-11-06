#!/usr/bin/env node
// Builds the evidence pack a person reads instead of the code: <runDir>/evidence.md, with the
// merge tier, the checks, before/after screenshots per page and width, recordings, the review
// verdict and the open follow-ups. Run it after .ui-verify/review.md is written.
//
//   node make-evidence.mjs [--root <project root>] [--pr]
//
// --pr also prints a pull request body (text only) to stdout.
// Reads .ui-verify/config.json keys "tokens" (paths whose change is a design change) and
// "shared" (paths of parts many pages use). Exit 0 always unless the inputs are missing (2).
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

const args = process.argv.slice(2);
const rootArg = args.indexOf("--root");
const root = resolve(rootArg === -1 ? process.cwd() : args[rootArg + 1]);
const wantPr = args.includes("--pr");
const uv = join(root, ".ui-verify");
const lastRunPath = join(uv, "last-run.json");
if (!existsSync(lastRunPath)) {
  console.error("make-evidence: no .ui-verify/last-run.json; run run-verify.mjs first.");
  process.exit(2);
}

const config = readJson(join(uv, "config.json")) ?? {};
const last = readJson(lastRunPath);
const runDir = last.runDir;
const reviewText = existsSync(join(uv, "review.md")) ? readFileSync(join(uv, "review.md"), "utf8") : "";
const verdict = /^Verdict:\s*(.+)$/im.exec(reviewText)?.[1].trim() ?? "missing";
const reviewer = /^Reviewer:\s*(.+)$/im.exec(reviewText)?.[1].trim() ?? "not stated";
const lines = reviewText.split("\n");
const open = lines.filter((l) => /^\s*-\s*\[ \]/.test(l));
const deferred = lines.filter((l) => /^\s*-\s*\[-\]/.test(l));
const notChecked = /^Not checked:\s*(.+)$/im.exec(reviewText)?.[1].trim() ?? "not stated";

const changed = gitLines(["status", "--porcelain", "--untracked-files=all"]).map((l) => l.slice(3).split(" -> ").pop());
const committed = gitLines(["diff", "--name-only", "HEAD@{upstream}...HEAD"]);
const touched = [...new Set([...changed, ...committed])].filter((f) => !f.startsWith(".ui-verify/"));
const isUnder = (f, prefixes) => (prefixes ?? []).some((p) => f === p || f.startsWith(p.replace(/\/?$/, "/")));
const designChanges = touched.filter((f) => f === "docs/design.md" || isUnder(f, config.tokens));
const baselineChanges = touched.filter((f) => /-snapshots\/.+\.png$/.test(f));
const sharedChanges = touched.filter((f) => isUnder(f, config.shared));

const ready = last.result === "pass" && /^approved\b/i.test(verdict) && open.length === 0;
const tier = !ready
  ? { id: "not ready", rule: "Checks or review did not pass. Do not merge." }
  : designChanges.length
    ? { id: "3", rule: "Design contract changed. The owner must confirm before merge." }
    : baselineChanges.length || sharedChanges.length
      ? { id: "2", rule: "Baselines or shared parts changed. Look at every before/after pair before merge." }
      : { id: "1", rule: "Verified and contained. A glance at this page is enough to merge." };

const shots = walk(runDir).filter((f) => /\.png$/.test(f) && !/[\\/](before|inspect|playwright)[\\/]/.test(f));
const snapshots = walk(root, (d) => !/node_modules|\.git$|\.next$|\.ui-verify$/.test(d)).filter((f) => /-snapshots[\\/].+\.png$/.test(f));
const pages = new Map();
for (const shot of shots) {
  const m = /^(.*)-(\d{3,4})\.png$/.exec(basename(shot));
  if (!m) continue;
  const [, name, width] = m;
  const group = basename(dirname(shot)) === basename(runDir) ? "" : basename(dirname(shot));
  const before = beforeImage(name, width);
  const key = `${group}/${name}`;
  if (!pages.has(key)) pages.set(key, { group, name, widths: [] });
  pages.get(key).widths.push({ width: Number(width), after: shot, before });
}
const recordings = walk(runDir).filter((f) => /\.(webm|mp4|mov|gif)$/.test(f));
const traces = walk(runDir).filter((f) => /trace\.zip$/.test(f));
const rel = (f) => relative(runDir, f).split("\\").join("/");

const md = [];
md.push(`# Evidence: ${basename(runDir)}`, "");
md.push(`**Merge tier: ${tier.id}.** ${tier.rule}`, "");
md.push(`- Checks: ${last.result} (${last.checks.map((c) => `${c.name} ${c.exitCode === 0 ? "pass" : "FAIL"}`).join(", ")})`);
md.push(`- Review: ${verdict}, by ${reviewer}; ${open.length} open, ${deferred.length} deferred`);
md.push(`- Design contract changes: ${list(designChanges)}`);
md.push(`- Baselines changed: ${list(baselineChanges)}`);
md.push(`- Shared parts changed: ${list(sharedChanges)}`);
md.push(`- Not checked: ${notChecked}`, "");
md.push("## Pages", "");
for (const p of [...pages.values()].sort((a, b) => (a.group + a.name).localeCompare(b.group + b.name))) {
  md.push(`### ${p.group ? `${p.group} / ` : ""}${p.name}`, "", "| Width | Before (baseline) | After |", "| --- | --- | --- |");
  for (const w of p.widths.sort((a, b) => a.width - b.width)) {
    const before = w.before ? `![before](${rel(w.before)})` : "new page, no baseline";
    md.push(`| ${w.width} | ${before} | ![after](${rel(w.after)}) |`);
  }
  md.push("");
}
md.push("## Recordings", "", ...(recordings.length ? recordings.map((r) => `- [${rel(r)}](${rel(r)})`) : ["- none (enable video in the Playwright config, startRecording in Maestro flows)"]), "");
if (traces.length) md.push("## Traces", "", ...traces.map((t) => `- [${rel(t)}](${rel(t)}) (open with \`npx playwright show-trace\`)`), "");
md.push("## Open and deferred findings", "", ...(open.length + deferred.length ? [...open, ...deferred] : ["- none"]), "");
md.push("## Logs", "", ...last.checks.map((c) => `- ${c.name}: [${rel(c.log)}](${rel(c.log)})`), "");

const evidencePath = join(runDir, "evidence.md");
writeFileSync(evidencePath, md.join("\n"));
console.error(`make-evidence: ${evidencePath} (tier ${tier.id}, ${pages.size} page(s), ${recordings.length} recording(s))`);

if (wantPr) {
  const pr = [
    "## Evidence",
    "",
    `**Merge tier: ${tier.id}.** ${tier.rule}`,
    "",
    `- Checks: ${last.result}; review: ${verdict} (${reviewer})`,
    `- Pages verified: ${[...pages.values()].map((p) => `${p.name} (${p.widths.map((w) => w.width).join("/")})`).join(", ") || "none"}`,
    `- Baselines changed: ${list(baselineChanges)}`,
    `- Design contract changes: ${list(designChanges)}`,
    `- Deferred follow-ups: ${deferred.length ? "" : "none"}`,
    ...deferred.map((d) => `  ${d.trim()}`),
    `- Not checked: ${notChecked}`,
    "",
    "Screenshots and recordings: attach them from the run folder, or the CI artifact of this run.",
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
    if (!changed.includes(relPath)) {
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

function gitLines(argv) {
  try {
    return execFileSync("git", argv, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function list(items) {
  return items.length ? items.map((i) => `\`${i}\``).join(", ") : "none";
}
