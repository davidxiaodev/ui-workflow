#!/usr/bin/env node
// Runs the project's checks from .verify/config.json, lane by lane, and records the outcome in
// .verify/last-run.json from real exit codes only, so the Stop gate can trust it.
//
//   node run-verify.mjs [--lane ui,api] [--only name,name] [--root <project root>]
//                       [--config base|working] [--base <ref>] [--keep-going]
//
// A lane stops at its first failing check (cheap checks first: order them in config.json from
// fastest to slowest); the rest are recorded as skipped. --keep-going runs every check anyway.
//   node run-verify.mjs --restore     put back files a crashed negative check left reverted
//   node run-verify.mjs --migrate     move a 0.1 .ui-verify/ setup to .verify/ (lane "ui")
//
// config.json:
//   { "lanes": { "api": { "files": ["services/api/**"], "checks": [
//       { "name": "unit", "run": "pnpm test", "cwd": "services/api", "timeoutMin": 20 },
//       { "name": "negative", "negative": { "test": "pnpm --dir services/api test" } } ] } } }
// A check with "negative" instead of "run" is the built-in negative check (lib/negative.mjs).
// Each check gets VERIFY_RUN_DIR (and UI_VERIFY_RUN_DIR, the 0.1 name) and VERIFY_LANE.
//
// The checks come from .verify/config.json as it is on the base commit (the merge-base with the
// default branch, or --base / VERIFY_BASE), so a change cannot edit the checks that judge it.
// --config working uses the working copy: for a change that sets up or extends the checks. That
// change is a guarded change (merge tier 3) either way.
//
// The run records a hash of the working tree (lib/verify-config.mjs treeHash). The Stop gate and
// make-evidence compare it with the tree now and with the one each review names, instead of
// trusting file times.
// Exit 0 = every check passed, 1 = a check failed, 2 = no config or nothing to run.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { backupExists, restore, runNegative } from "./lib/negative.mjs";
import { legacyConfigExists, loadConfig, readJson, resolveBase, treeHash, VERIFY_DIR } from "./lib/verify-config.mjs";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const root = resolve(opt("root") ?? process.cwd());

if (args.includes("--migrate")) process.exit(migrate());

const configSource = opt("config") ?? "base";
if (!["base", "working"].includes(configSource)) {
  console.error('run-verify: --config takes "base" or "working".');
  process.exit(2);
}
const cfg = loadConfig(root, { source: configSource, base: opt("base") ? resolveBase(root, opt("base")) : undefined });
if (!cfg) {
  console.error(
    legacyConfigExists(root)
      ? "run-verify: this project still uses .ui-verify/ (ui-workflow 0.1). Run run-verify.mjs --migrate first."
      : `run-verify: no ${join(root, VERIFY_DIR, "config.json")}. Create it from the plugin's shared/verify.config.json.`,
  );
  process.exit(2);
}

if (args.includes("--restore")) {
  const n = restore(cfg.dir, root);
  console.log(n ? `run-verify: restored ${n} file(s) from the negative-check backup.` : "run-verify: no negative-check backup to restore.");
  process.exit(0);
}
if (backupExists(cfg.dir)) {
  console.error("run-verify: a negative check did not finish and left source files reverted. Run run-verify.mjs --restore first.");
  process.exit(2);
}

const wantLanes = opt("lane")?.split(",").filter(Boolean);
const only = opt("only")?.split(",").filter(Boolean);
const lanes = cfg.lanes.filter((l) => !wantLanes || wantLanes.includes(l.name));
const unknown = (wantLanes ?? []).filter((n) => !cfg.lanes.some((l) => l.name === n));
if (unknown.length) {
  console.error(`run-verify: no lane named ${unknown.join(", ")} in config.json (lanes: ${cfg.lanes.map((l) => l.name).join(", ")}).`);
  process.exit(2);
}
if (lanes.every((l) => l.checks.filter((c) => !only || only.includes(c.name)).length === 0)) {
  console.error("run-verify: config has no checks to run.");
  process.exit(2);
}

if (cfg.workingDiffers && cfg.source === "base") {
  console.log(
    "run-verify: .verify/config.json differs from the base commit; running the base's checks. For a change that sets up or extends the checks, rerun with --config working (the change is merge tier 3 either way).",
  );
}
if (cfg.source === "working" && configSource === "base") console.log("run-verify: no .verify/config.json on the base commit; using the working copy.");

const treeBefore = treeHash(root);
const startedAt = new Date();
const runDir = join(cfg.dir, "runs", startedAt.toISOString().replace(/[:.]/g, "-"));
mkdirSync(runDir, { recursive: true });

const previous = readJson(join(cfg.dir, "last-run.json"));
const record = {
  runDir,
  finishedAt: null,
  tree: null,
  base: cfg.base,
  config: { source: cfg.source, differsFromBase: cfg.workingDiffers },
  lanes: { ...(previous?.lanes ?? {}) },
};
const ranLanes = [];
let anyFailed = false;

for (const lane of lanes) {
  const checks = lane.checks.filter((c) => !only || only.includes(c.name));
  if (checks.length === 0) continue;
  const laneStarted = new Date().toISOString();
  const results = [];
  for (const check of checks) {
    if (!args.includes("--keep-going") && results.some((r) => r.exitCode !== 0)) {
      console.log(`run-verify: ${lane.name}/${check.name} … skipped (an earlier check failed; --keep-going runs it)`);
      results.push({ name: check.name, run: check.run ?? "built-in negative check", exitCode: null, skipped: true, seconds: 0, log: null, note: "skipped after an earlier failure" });
      continue;
    }
    const cwd = resolve(root, check.cwd ?? ".");
    const env = { ...process.env, VERIFY_RUN_DIR: runDir, UI_VERIFY_RUN_DIR: runDir, VERIFY_LANE: lane.name };
    const timeoutMs = (check.timeoutMin ?? 20) * 60_000;
    const t0 = Date.now();
    process.stdout.write(`run-verify: ${lane.name}/${check.name} … `);
    let exitCode;
    let note;
    let text;
    if (check.negative) {
      const r = runNegative({ root, dir: cfg.dir, lane, tests: cfg.tests, spec: check.negative, timeoutMs, env });
      ({ exitCode, note } = r);
      text = `negative check\n${note}\n\n${r.log}`;
    } else {
      const r = spawnSync(check.run, { cwd, shell: true, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 << 20, env });
      exitCode = r.status ?? (r.signal ? 124 : 1);
      text = `$ ${check.run}\n(cwd ${cwd})\n\n${r.stdout ?? ""}\n${r.stderr ?? ""}`;
    }
    const log = join(runDir, `${lane.name}-${check.name}.log`);
    writeFileSync(log, text);
    const seconds = Math.round((Date.now() - t0) / 1000);
    console.log(`${exitCode === 0 ? "pass" : `FAIL (exit ${exitCode})`} in ${seconds}s${note ? ` (${note})` : ""}`);
    results.push({ name: check.name, run: check.run ?? "built-in negative check", exitCode, seconds, log, ...(note ? { note } : {}) });
  }
  const failed = results.filter((r) => r.exitCode !== 0 && !r.skipped);
  anyFailed ||= failed.length > 0;
  record.lanes[lane.name] = {
    startedAt: laneStarted,
    finishedAt: new Date().toISOString(),
    result: failed.length ? "fail" : only ? "partial" : "pass",
    runDir,
    tree: null,
    config: cfg.source,
    checks: results,
  };
  ranLanes.push(lane.name);
  console.log(`run-verify: lane ${lane.name}: ${record.lanes[lane.name].result}${failed.length ? ` (failed: ${failed.map((f) => f.name).join(", ")})` : ""}`);
}

// The tree the checks saw. A check that wrote to tracked or untracked source files (a formatter in
// write mode, a code generator) makes the run unusable: what passed is not what is on disk.
const treeAfter = treeHash(root);
record.tree = treeAfter;
for (const name of ranLanes) {
  record.lanes[name].tree = treeAfter;
  if (treeBefore !== treeAfter) {
    record.lanes[name].result = "fail";
    record.lanes[name].note = "files changed while the checks ran; a check writes to the source (run formatters in check mode)";
  }
}
if (treeBefore !== treeAfter) {
  anyFailed = true;
  console.log("run-verify: files changed while the checks ran, so the result does not describe what is on disk. Run formatters and generators in check mode, then rerun.");
}

record.finishedAt = new Date().toISOString();
writeFileSync(join(cfg.dir, "last-run.json"), JSON.stringify(record, null, 2) + "\n");

console.log(`\nrun-verify: logs and evidence in ${runDir}`);
if (anyFailed) console.log("Read the failing logs before changing anything. Never weaken a test or a check to get green.");
if (only) console.log("A run with --only is recorded as partial and does not satisfy the Stop gate.");
process.exit(anyFailed ? 1 : 0);

function migrate() {
  const oldDir = join(root, ".ui-verify");
  const newDir = join(root, VERIFY_DIR);
  if (!existsSync(join(oldDir, "config.json"))) {
    console.error("run-verify --migrate: no .ui-verify/config.json here.");
    return 2;
  }
  if (existsSync(join(newDir, "config.json"))) {
    console.error("run-verify --migrate: .verify/config.json already exists; nothing moved.");
    return 2;
  }
  const old = JSON.parse(readFileSync(join(oldDir, "config.json"), "utf8"));
  renameSync(oldDir, newDir);
  const { checks = [], tokens, shared, ...rest } = old;
  const config = { ...rest, lanes: { ui: { ...(tokens ? { tokens } : {}), ...(shared ? { shared } : {}), checks } } };
  writeFileSync(join(newDir, "config.json"), JSON.stringify(config, null, 2) + "\n");
  if (existsSync(join(newDir, "review.md"))) renameSync(join(newDir, "review.md"), join(newDir, "review-ui.md"));
  console.log(
    [
      'run-verify --migrate: moved .ui-verify/ to .verify/ and its checks into lane "ui"; review.md is now review-ui.md.',
      "Still to do by hand:",
      "- .gitignore: replace .ui-verify/runs/ with the two lines `.verify/*` and `!.verify/config.json`.",
      "- Commands in config.json that write to $UI_VERIFY_RUN_DIR keep working; new ones use $VERIFY_RUN_DIR.",
      "- Write .verify/acceptance.md for the next change (<plugin>/shared/acceptance.md).",
    ].join("\n"),
  );
  return 0;
}
