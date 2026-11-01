#!/usr/bin/env node
// Runs the project's UI checks from .ui-verify/config.json and records the outcome.
// The record (.ui-verify/last-run.json) is written from real exit codes only, so the
// Stop gate can trust it.
//
//   node run-verify.mjs [--only name,name] [--root <project root>]
//
// config.json: { "checks": [ { "name": "e2e", "run": "pnpm test:e2e", "cwd": "apps/web", "timeoutMin": 20 } ] }
// Exit 0 = every check passed, 1 = a check failed, 2 = no config.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const root = resolve(opt("root") ?? process.cwd());
const only = opt("only")?.split(",").filter(Boolean);
const configPath = join(root, ".ui-verify", "config.json");

if (!existsSync(configPath)) {
  console.error(`run-verify: no ${configPath}. Create it from the skill's templates/ui-verify.config.json.`);
  process.exit(2);
}

const config = JSON.parse(readFileSync(configPath, "utf8"));
const checks = (config.checks ?? []).filter((c) => !only || only.includes(c.name));
if (checks.length === 0) {
  console.error("run-verify: config has no checks to run.");
  process.exit(2);
}

const startedAt = new Date();
const runDir = join(root, ".ui-verify", "runs", startedAt.toISOString().replace(/[:.]/g, "-"));
mkdirSync(runDir, { recursive: true });

const results = [];
for (const check of checks) {
  const cwd = resolve(root, check.cwd ?? ".");
  const t0 = Date.now();
  process.stdout.write(`run-verify: ${check.name} … `);
  const r = spawnSync(check.run, {
    cwd,
    shell: true,
    encoding: "utf8",
    timeout: (check.timeoutMin ?? 20) * 60_000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, UI_VERIFY_RUN_DIR: runDir },
  });
  const exitCode = r.status ?? (r.signal ? 124 : 1);
  const log = join(runDir, `${check.name}.log`);
  writeFileSync(log, `$ ${check.run}\n(cwd ${cwd})\n\n${r.stdout ?? ""}\n${r.stderr ?? ""}`);
  const seconds = Math.round((Date.now() - t0) / 1000);
  console.log(`${exitCode === 0 ? "pass" : `FAIL (exit ${exitCode})`} in ${seconds}s`);
  results.push({ name: check.name, run: check.run, exitCode, seconds, log });
}

const failed = results.filter((r) => r.exitCode !== 0);
const record = {
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  result: failed.length === 0 && !only ? "pass" : failed.length === 0 ? "partial" : "fail",
  runDir,
  checks: results,
};
writeFileSync(join(root, ".ui-verify", "last-run.json"), JSON.stringify(record, null, 2) + "\n");

console.log(`\nrun-verify: ${record.result}. Logs and evidence: ${runDir}`);
if (failed.length) console.log(`Failed: ${failed.map((f) => f.name).join(", ")}. Read their logs before changing anything.`);
if (only) console.log("A run with --only is recorded as partial and does not satisfy the Stop gate.");
process.exit(failed.length ? 1 : 0);
