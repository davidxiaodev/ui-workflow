#!/usr/bin/env node
// Reviewer evals: does code-review.md find known bugs, and does it leave clean changes alone?
//
//   node evals/run.mjs prepare <case> [--out <dir>]   build the case as a project, run the checks, write the brief
//   node evals/run.mjs score <dir> <case>              score the .verify/review-api.md a reviewer wrote there
//   node evals/run.mjs all [--reviewer "<command>"] [--case <name>]
//
// `all` prepares every case; with --reviewer it runs the command in each project with the brief on
// stdin (for example: --reviewer "claude -p --permission-mode acceptEdits"), scores the review, prints
// a table and writes evals/results/<time>.json. Without --reviewer it prints where the projects and
// briefs are, so a person or an agent can dispatch the reviewers and run `score` afterwards.
//
// A case is evals/cases/<name>/: case.json, before/ (the base commit) and after/ (the change on top).
// case.json: { lane, kind: "bug" | "clean", request, acceptance: [..], answer, match: [regex, ..] }.
// A bug counts as found when one open Blocker or Should-fix line matches every regex in `match`
// (case-insensitive). A clean case counts a false positive for every open Blocker.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = resolve(HERE, "../plugins/workflow/scripts");
const CASES = join(HERE, "cases");
const GIT_ENV = { GIT_AUTHOR_NAME: "eval", GIT_AUTHOR_EMAIL: "eval@example.com", GIT_COMMITTER_NAME: "eval", GIT_COMMITTER_EMAIL: "eval@example.com", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const TESTS = "for f in test/*.test.mjs; do node \"$f\" || exit 1; done";

const [cmd, ...rest] = process.argv.slice(2);
const opt = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? undefined : rest[i + 1];
};

if (import.meta.url === `file://${process.argv[1]}`) {
  if (cmd === "prepare") console.log(JSON.stringify(prepare(rest[0], opt("out")), null, 2));
  else if (cmd === "score") console.log(JSON.stringify(score(rest[0], loadCase(rest[1])), null, 2));
  else if (cmd === "all") all();
  else {
    console.error("usage: run.mjs prepare <case> [--out dir] | score <dir> <case> | all [--reviewer cmd] [--case name]");
    process.exit(2);
  }
}

export function loadCase(name) {
  const dir = join(CASES, name);
  if (!existsSync(join(dir, "case.json"))) throw new Error(`no case ${name}`);
  return { name, dir, ...JSON.parse(readFileSync(join(dir, "case.json"), "utf8")) };
}

export function prepare(name, out) {
  const c = loadCase(name);
  const base = out ?? mkdtempSync(join(tmpdir(), `eval-${name}-`));
  const root = join(base, "project");
  const origin = join(base, "origin.git");
  mkdirSync(root, { recursive: true });
  git(base, "init", "-q", "--bare", "-b", "main", origin);
  git(root, "init", "-q", "-b", "main");
  cpSync(join(c.dir, "before"), root, { recursive: true });
  const config = {
    lanes: {
      [c.lane]: {
        files: ["src/**", "test/**"],
        checks: [
          { name: "unit", run: TESTS },
          { name: "negative", negative: { test: TESTS } },
        ],
      },
    },
  };
  mkdirSync(join(root, ".verify"), { recursive: true });
  writeFileSync(join(root, ".verify/config.json"), JSON.stringify(config, null, 2) + "\n");
  writeFileSync(join(root, ".gitignore"), ".verify/*\n!.verify/config.json\n");
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs/backend.md"), "# Backend contract\n\nErrors: { error } bodies with the right status. Every object read is scoped to the caller.\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  git(root, "remote", "add", "origin", origin);
  git(root, "push", "-q", "origin", "main");
  git(root, "remote", "set-head", "origin", "main");
  git(root, "checkout", "-q", "-b", "change");
  cpSync(join(c.dir, "after"), root, { recursive: true });
  writeFileSync(
    join(root, ".verify/acceptance.md"),
    [`# Acceptance: ${c.request}`, `Request: ${c.request}`, `Lanes: ${c.lane}`, "", "## Criteria", ...c.acceptance.map((a) => `- ${a}`), ""].join("\n"),
  );
  const run = spawnSync(process.execPath, [join(SCRIPTS, "run-verify.mjs"), "--lane", c.lane], { cwd: root, encoding: "utf8", env: { ...process.env, ...GIT_ENV } });
  const brief = spawnSync(process.execPath, [join(SCRIPTS, "review-brief.mjs"), "--lane", c.lane, "--request", c.request], { cwd: root, encoding: "utf8", env: { ...process.env, ...GIT_ENV } });
  return { case: name, root, checks: run.status === 0 ? "pass" : `fail (exit ${run.status})`, brief: brief.status === 0 ? join(root, ".verify", `brief-${c.lane}.md`) : `failed: ${brief.stderr.trim()}` };
}

/** Scores a review against the case. */
export function score(root, c) {
  const path = join(root, ".verify", `review-${c.lane}.md`);
  if (!existsSync(path)) return { case: c.name, kind: c.kind, error: "no review written" };
  const text = readFileSync(path, "utf8");
  const findings = text.split("\n").filter((l) => /^\s*-\s*\[ \]\s*(Blocker|Should-fix)\b/i.test(l));
  const blockers = findings.filter((l) => /Blocker/i.test(l));
  const verdict = /^Verdict:\s*(.+)$/im.exec(text)?.[1].trim() ?? "missing";
  const hasTree = /^Tree:\s*[0-9a-f]{7,40}/im.test(text);
  if (c.kind === "bug") {
    const res = (c.match ?? []).map((m) => new RegExp(m, "i"));
    const hit = findings.find((l) => res.every((re) => re.test(l)));
    return { case: c.name, kind: "bug", found: Boolean(hit), severity: hit ? (/Blocker/i.test(hit) ? "Blocker" : "Should-fix") : null, verdict, hasTree, findings: findings.length };
  }
  return { case: c.name, kind: "clean", falsePositives: blockers.length, approved: /^approved\b/i.test(verdict), verdict, hasTree, findings: findings.length };
}

function all() {
  const reviewer = opt("reviewer");
  const names = opt("case") ? [opt("case")] : readdirSync(CASES).filter((n) => existsSync(join(CASES, n, "case.json")));
  const results = [];
  for (const name of names) {
    const p = prepare(name);
    if (!reviewer) {
      console.log(`${name}: ${p.root} (checks ${p.checks}; brief ${p.brief})`);
      continue;
    }
    const brief = readFileSync(p.brief, "utf8");
    const r = spawnSync(reviewer, { cwd: p.root, shell: true, input: brief, encoding: "utf8", timeout: 20 * 60_000, maxBuffer: 64 << 20 });
    results.push({ ...score(p.root, loadCase(name)), reviewerExit: r.status, root: p.root });
  }
  if (!reviewer) {
    console.log("\nDispatch a fresh reviewer in each project with its brief, then: node evals/run.mjs score <project> <case>");
    return;
  }
  const bugs = results.filter((r) => r.kind === "bug");
  const clean = results.filter((r) => r.kind === "clean");
  const summary = {
    at: new Date().toISOString(),
    reviewer,
    recall: bugs.length ? bugs.filter((r) => r.found).length / bugs.length : null,
    blockerRecall: bugs.length ? bugs.filter((r) => r.severity === "Blocker").length / bugs.length : null,
    cleanApproved: clean.length ? clean.filter((r) => r.approved && r.falsePositives === 0).length / clean.length : null,
    falsePositives: clean.reduce((n, r) => n + (r.falsePositives ?? 0), 0),
    results,
  };
  for (const r of results) console.log(`${r.case.padEnd(30)} ${r.kind.padEnd(6)} ${r.kind === "bug" ? (r.found ? `found (${r.severity})` : "MISSED") : r.falsePositives ? `${r.falsePositives} false Blocker(s)` : r.approved ? "approved" : r.verdict}`);
  console.log(`\nrecall ${pct(summary.recall)} (as Blocker ${pct(summary.blockerRecall)}), clean approved ${pct(summary.cleanApproved)}, false Blockers ${summary.falsePositives}`);
  mkdirSync(join(HERE, "results"), { recursive: true });
  const outFile = join(HERE, "results", `${summary.at.replace(/[:.]/g, "-")}.json`);
  writeFileSync(outFile, JSON.stringify(summary, null, 2) + "\n");
  console.log(outFile);
}

function pct(x) {
  return x === null ? "n/a" : `${Math.round(x * 100)}%`;
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...GIT_ENV }, stdio: ["ignore", "pipe", "pipe"] });
}
