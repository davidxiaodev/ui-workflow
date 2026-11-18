#!/usr/bin/env node
// The gates between the flow's stages, as checks that exit for real.
//
//   node flow-check.mjs spec <docs/specs/x.md>               may we plan and build from this spec?
//   node flow-check.mjs tasks <docs/specs/x.tasks.md>         is the task list complete and buildable?
//   node flow-check.mjs next <docs/specs/x.tasks.md> [--done T1,T2]   which tasks can start now
//   node flow-check.mjs acceptance <docs/specs/x.md> [T2] [--write]   the task's .verify/acceptance.md
//
// The task list's spec is the file next to it without ".tasks". Exit 0 = gate open, 1 = problems
// (printed one per line), 2 = usage error. `acceptance --write` refuses while the spec gate is shut.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { checkSpec, checkTasks, parseSpec, parseTasks, readyTasks, taskAcceptance } from "./lib/flow.mjs";
import { gitRoot, loadConfig } from "./lib/verify-config.mjs";

const [cmd, file, ...rest] = process.argv.slice(2);
const opt = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? undefined : rest[i + 1];
};
if (!cmd || !file) usage();
const path = resolve(file);
if (!existsSync(path)) fail(`flow-check: no ${file}.`);
const root = gitRoot(dirname(path)) ?? process.cwd();
const rel = (p) => relative(root, p);
const specPathFor = (tasksFile) => tasksFile.replace(/\.tasks\.md$/, ".md");
const read = (p) => readFileSync(p, "utf8");

if (cmd === "spec") {
  report("spec", checkSpec(parseSpec(read(path))), `the spec is agreed and complete: write the task list (shared/tasks.md) or, for one pull request, the acceptance: flow-check.mjs acceptance ${rel(path)} --write`);
} else if (cmd === "tasks") {
  const specFile = specPathFor(path);
  if (specFile === path || !existsSync(specFile)) fail(`flow-check: a task list is <spec>.tasks.md next to its spec; no ${rel(specFile)}.`);
  const spec = parseSpec(read(specFile));
  const lanes = loadConfig(root)?.lanes.map((l) => l.name) ?? null;
  const tasks = parseTasks(read(path));
  const problems = [...checkSpec(spec).map((p) => `spec: ${p}`), ...checkTasks(tasks, spec, lanes)];
  report("tasks", problems, `${tasks.length} task(s) cover every criterion. Start with: ${readyTasks(tasks).map((t) => t.id).join(", ")}`);
} else if (cmd === "next") {
  const done = (opt("done") ?? "").split(",").filter(Boolean);
  const ready = readyTasks(parseTasks(read(path)), done);
  console.log(ready.length ? ready.map((t) => `${t.id} ${t.title} · lanes: ${t.lanes.join(", ")} · ${t.acceptance.join(", ")}`).join("\n") : "no task is ready (all done, or waiting on a dependency)");
} else if (cmd === "acceptance") {
  const spec = parseSpec(read(path));
  const taskId = rest.find((a) => /^T\d+$/.test(a));
  const tasksFile = path.replace(/\.md$/, ".tasks.md");
  let task = null;
  if (taskId) {
    if (!existsSync(tasksFile)) fail(`flow-check: no ${rel(tasksFile)} for ${taskId}.`);
    task = parseTasks(read(tasksFile)).find((t) => t.id === taskId);
    if (!task) fail(`flow-check: no task ${taskId} in ${rel(tasksFile)}.`);
  }
  const text = taskAcceptance(spec, task, { specPath: rel(path), tasksPath: rel(tasksFile) });
  if (rest.includes("--write")) {
    const problems = checkSpec(spec);
    if (problems.length) report("spec", problems, "");
    const out = join(root, ".verify", "acceptance.md");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text);
    console.log(`flow-check: wrote ${rel(out)} (${task ? `${task.id}, ` : ""}${text.split("\n").filter((l) => /^- A\d+/.test(l)).length} criteria). Add the adverse cases for its lanes.`);
  } else process.stdout.write(text);
} else usage();

function report(gate, problems, next) {
  if (problems.length) {
    console.log(`flow-check ${gate}: shut, ${problems.length} problem(s)`);
    for (const p of problems) console.log(`- ${p}`);
    process.exit(1);
  }
  console.log(`flow-check ${gate}: open. ${next}`.trim());
  process.exit(0);
}

function usage() {
  console.error("usage: flow-check.mjs spec <spec.md> | tasks <spec.tasks.md> | next <spec.tasks.md> [--done T1,T2] | acceptance <spec.md> [T<n>] [--write]");
  process.exit(2);
}

function fail(message) {
  console.error(message);
  process.exit(2);
}
