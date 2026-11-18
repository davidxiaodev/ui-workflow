import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { checkSpec, checkTasks, parseSpec, parseTasks, readyTasks } from "../plugins/dx-workflow/scripts/lib/flow.mjs";
import { addFeature, cleanup, evidenceText, makeProject, node, read, verify, write } from "./helpers.mjs";

const roots = [];
const project = (opts) => {
  const r = makeProject(opts);
  roots.push(r);
  return r;
};
after(() => roots.forEach(cleanup));

const SPEC = `# Spec: Subtraction for the calculator
Status: agreed
Owner: David

## Problem
Users can only add.

## Goals
- S1 A user can subtract two numbers
- S2 Negative results are shown, not hidden

## Non-goals
- Multiplication

## Decisions
- D1 Integers only · keeps parsing simple · David

## Open questions
- Q1 Decimals? → D1
- Q2 Locale formatting? · deferred: integers have no separators to localise

## Acceptance
- A1 sub(5, 3) returns 2 (S1) · proof: test/run.mjs
- A2 sub(3, 5) returns -2 (S1, S2) · proof: test/run.mjs
`;

const TASKS = `# Tasks: Subtraction

## T1 Core sub
- lanes: backend
- acceptance: A1
- depends: none
- size: S
- risk: 1 · new function only

## T2 Negative results
- lanes: backend
- acceptance: A2
- depends: T1
- size: S
- risk: 1 · same module
`;

describe("spec gate", () => {
  it("opens for a complete, agreed spec", () => {
    assert.deepEqual(checkSpec(parseSpec(SPEC)), []);
  });

  it("names every reason it is shut", () => {
    const bad = SPEC.replace("Status: agreed", "Status: draft")
      .replace("- Q1 Decimals? → D1", "- Q1 Decimals? · owner: David")
      .replace("- A2 sub(3, 5) returns -2 (S1, S2) · proof: test/run.mjs", "- A2 sub(3, 5) returns -2 (S1, S9)")
      .replace("- Multiplication\n", "");
    const p = checkSpec(parseSpec(bad)).join("\n");
    assert.match(p, /Status is "draft"/);
    assert.match(p, /Q1 is open/);
    assert.match(p, /S2 has no acceptance criterion/);
    assert.match(p, /A2 cites S9, which is not a goal/);
    assert.match(p, /A2 names no proof/);
    assert.match(p, /no non-goals/);
  });
});

describe("tasks gate", () => {
  const spec = parseSpec(SPEC);

  it("opens when every criterion is in a task, and lists what can start", () => {
    const tasks = parseTasks(TASKS);
    assert.deepEqual(checkTasks(tasks, spec, ["backend"]), []);
    assert.deepEqual(readyTasks(tasks).map((t) => t.id), ["T1"]);
    assert.deepEqual(readyTasks(tasks, ["T1"]).map((t) => t.id), ["T2"]);
  });

  it("shuts on uncovered criteria, unknown lanes, large tasks, missing risk and cycles", () => {
    const bad = TASKS.replace("- acceptance: A2", "- acceptance: A7")
      .replace("- depends: none", "- depends: T2")
      .replace("- lanes: backend\n- acceptance: A1", "- lanes: mobile\n- acceptance: A1")
      .replace("- size: S\n- risk: 1 · same module", "- size: L");
    const p = checkTasks(parseTasks(bad), spec, ["backend"]).join("\n");
    assert.match(p, /T2 cites A7/);
    assert.match(p, /A2 is in no task/);
    assert.match(p, /T1: lane "mobile" is not in/);
    assert.match(p, /T2 size is "L"/);
    assert.match(p, /T2 risk is "missing"/);
    assert.match(p, /circle: T1 → T2 → T1|circle: T2 → T1 → T2/);
  });
});

describe("flow-check CLI", () => {
  it("gates, lists the next task, and writes a traced acceptance file the evidence pack carries", () => {
    const root = project();
    write(root, { "docs/specs/sub.md": SPEC, "docs/specs/sub.tasks.md": TASKS });
    assert.equal(node("flow-check.mjs", ["spec", "docs/specs/sub.md"], { cwd: root }).code, 0);
    const t = node("flow-check.mjs", ["tasks", "docs/specs/sub.tasks.md"], { cwd: root });
    assert.equal(t.code, 0, t.stdout);
    assert.match(t.stdout, /Start with: T1/);
    assert.match(node("flow-check.mjs", ["next", "docs/specs/sub.tasks.md", "--done", "T1"], { cwd: root }).stdout, /^T2 Negative results/);

    const w = node("flow-check.mjs", ["acceptance", "docs/specs/sub.md", "T1", "--write"], { cwd: root });
    assert.equal(w.code, 0, w.stderr);
    const acc = read(root, ".verify/acceptance.md");
    assert.match(acc, /^Spec: docs\/specs\/sub\.md$/m);
    assert.match(acc, /^Task: T1 \(docs\/specs\/sub\.tasks\.md\)$/m);
    assert.match(acc, /^Lanes: backend$/m);
    assert.match(acc, /^- A1 sub\(5, 3\) returns 2/m);
    assert.doesNotMatch(acc, /A2/);
    assert.match(acc, /^- S1 A user can subtract two numbers$/m);

    addFeature(root);
    verify(root, { acceptance: false });
    assert.match(evidenceText(root), /^Spec: docs\/specs\/sub\.md\nTask: T1/m);
  });

  it("refuses to write acceptance from a spec the user has not agreed", () => {
    const root = project();
    write(root, { "docs/specs/sub.md": SPEC.replace("Status: agreed", "Status: draft") });
    const r = node("flow-check.mjs", ["acceptance", "docs/specs/sub.md", "--write"], { cwd: root });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /Status is "draft"/);
  });
});

describe("repeated failures", () => {
  it("sends the second failure in a row to debugging, resets on a pass, and the evidence shows the cause", () => {
    const root = project();
    write(root, { "src/math.mjs": "export const add = (a, b) => a - b;\n" });
    let r = node("run-verify.mjs", ["--only", "unit"], { cwd: root });
    assert.doesNotMatch(r.stdout, /failed again/);
    r = node("run-verify.mjs", ["--only", "unit"], { cwd: root });
    assert.match(r.stdout, /failed again: backend\/unit \(2 runs\)\. .*shared\/debug\.md/);
    assert.equal(JSON.parse(read(root, ".verify/last-run.json")).lanes.backend.checks[0].failedRunsInARow, 2);

    write(root, { "src/math.mjs": "export const add = (a, b) => a + b;\n" });
    node("run-verify.mjs", ["--only", "unit"], { cwd: root });
    assert.deepEqual(JSON.parse(read(root, ".verify/failures.json")), {});

    addFeature(root);
    write(root, { ".verify/debug.md": "# Debug\n- check: backend/unit · failed 2 runs in a row\n- cause: add subtracted\n" });
    verify(root);
    assert.match(evidenceText(root), /## Diagnosed failures\n\n- check: backend\/unit/);
  });
});
