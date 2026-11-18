import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { matchChecklist, parseChecklist } from "../plugins/dx-workflow/scripts/lib/checklist.mjs";
import { addFeature, cleanup, CONFIG, gate, makeProject, node, read, verify, write } from "./helpers.mjs";

const roots = [];
const project = (opts) => {
  const r = makeProject(opts);
  roots.push(r);
  return r;
};
after(() => roots.forEach(cleanup));
const brief = (root, extra = []) => node("review-brief.mjs", ["--lane", "backend", "--request", "add sub", ...extra], { cwd: root });

const CHECKLIST = `# Reliability checklist

## C1 Subtraction never goes negative for money
- when: diff \`/\\bsub\\b/\` or path \`src/money/**\`
- lanes: backend
- check: sub(1, 2) on amounts returns an error, not -1.
- source: incident 2026-09-01

## C2 Sessions load
- when: path \`src/session/**\`
- check: old transcripts load.
- source: PR #4

## C3 Broken
- when: sometimes
`;

describe("checklist", () => {
  it("parses items, triggers and errors", () => {
    const items = parseChecklist(CHECKLIST);
    assert.deepEqual(items.map((i) => i.id), ["C1", "C2", "C3"]);
    assert.deepEqual(items[0].paths, ["src/money/**"]);
    assert.equal(items[0].patterns.length, 1);
    assert.deepEqual(items[0].lanes, ["backend"]);
    assert.match(items[2].errors.join(), /unreadable trigger/);
  });

  it("matches by changed path or changed line, and by lane", () => {
    const items = parseChecklist(CHECKLIST);
    const hit = (paths, lines, lane) => matchChecklist(items, { paths, lines, lane }).map((i) => i.id);
    assert.deepEqual(hit(["src/session/a.ts"], [], "backend"), ["C2"]);
    assert.deepEqual(hit(["src/x.ts"], ["+export const sub = 1"], "backend"), ["C1"]);
    assert.deepEqual(hit(["src/x.ts"], ["+export const sub = 1"], "frontend"), []);
    assert.deepEqual(hit(["src/x.ts"], ["+subtle"], "backend"), []);
  });
});

describe("review-brief", () => {
  it("refuses until run-verify passed on the current tree", () => {
    const root = project();
    addFeature(root);
    assert.equal(brief(root).code, 2);
  });

  it("names the tree, sets depth, and lists triggered checklist items from the base commit", () => {
    const root = project({ files: { "docs/checklist.md": CHECKLIST } });
    addFeature(root);
    node("run-verify.mjs", [], { cwd: root });
    const r = brief(root);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Tree under review: [0-9a-f]{40}/);
    assert.match(r.stdout, /## Depth: quick/);
    assert.match(r.stdout, /- C1 Subtraction never goes negative/);
    assert.doesNotMatch(r.stdout, /C2 Sessions/);
    assert.match(r.stdout, /C3: unreadable trigger/);
    assert.match(r.stdout, /backend\/code-review\.md/);
    assert.doesNotMatch(r.stdout, /<plugin>/);
    assert.ok(existsSync(join(root, ".verify/brief-backend.md")));
  });

  it("gives a frontend lane both the design review and the frontend code review", () => {
    const root = project({ config: { lanes: { web: { kind: "frontend", files: ["src/**", "test/**"], checks: [{ name: "unit", run: "node test/run.mjs" }] } } } });
    addFeature(root);
    node("run-verify.mjs", [], { cwd: root });
    const r = node("review-brief.mjs", ["--lane", "web", "--request", "add sub", "--scope", "home at 390"], { cwd: root });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /skills\/frontend\/design-review\.md for the screenshots, then .*skills\/frontend\/code-review\.md for the code/);
    assert.match(r.stdout, /docs\/design\.md/);
    assert.match(r.stdout, /Scope: home at 390/);
  });

  it("goes deep on sensitive paths and asks to disprove Blockers", () => {
    const root = project({ config: { ...CONFIG, lanes: { backend: { ...CONFIG.lanes.backend, sensitive: ["src/math.mjs"] } } } });
    addFeature(root);
    node("run-verify.mjs", [], { cwd: root });
    const r = brief(root);
    assert.match(r.stdout, /## Depth: deep \(sensitive: src\/math\.mjs\)/);
    assert.match(r.stdout, /try to disprove it/);
  });

  it("lists new untracked files the diff does not show", () => {
    const root = project();
    addFeature(root);
    write(root, { "src/extra.mjs": "export const x = 1;\n" });
    node("run-verify.mjs", [], { cwd: root });
    assert.match(brief(root).stdout, /new files not yet in git.*src\/extra\.mjs/);
  });

  it("gives round 2 the previous findings and only the new diff, and stops after three rounds", () => {
    const root = project();
    addFeature(root);
    for (let round = 1; round <= 3; round++) {
      write(root, { "src/math.mjs": read(root, "src/math.mjs") + `// round ${round}\n` });
      node("run-verify.mjs", [], { cwd: root });
      const r = brief(root);
      assert.equal(r.code, 0, `round ${round}: ${r.stderr}`);
      assert.match(r.stdout, new RegExp(`round ${round} of at most 3`));
      if (round === 2) {
        assert.match(r.stdout, /## Round 2: what changed since round 1/);
        assert.match(r.stdout, /git diff [0-9a-f]{40} [0-9a-f]{40}/);
        assert.match(r.stdout, /- \[ \] Blocker · src\/math\.mjs:1 · wrong/);
      }
      const last = JSON.parse(read(root, ".verify/last-run.json"));
      write(root, { ".verify/review-backend.md": `# Review\nTree: ${last.lanes.backend.tree}\n\n## Findings\n- [ ] Blocker · src/math.mjs:1 · wrong\n\nVerdict: changes required\n` });
    }
    write(root, { "src/math.mjs": read(root, "src/math.mjs") + "// round 4\n" });
    node("run-verify.mjs", [], { cwd: root });
    const r4 = brief(root);
    assert.equal(r4.code, 3);
    assert.match(r4.stderr, /3 review rounds of lane backend ended without approval/);
  });

  it("restarts the round count for a new change (new acceptance)", () => {
    const root = project();
    addFeature(root);
    write(root, { ".verify/acceptance.md": "- A1 one\n" });
    node("run-verify.mjs", [], { cwd: root });
    brief(root);
    const last = JSON.parse(read(root, ".verify/last-run.json"));
    write(root, { ".verify/review-backend.md": `Tree: ${last.lanes.backend.tree}\nVerdict: changes required\n`, "src/math.mjs": read(root, "src/math.mjs") + "//x\n" });
    node("run-verify.mjs", [], { cwd: root });
    assert.match(brief(root).stdout, /round 2/);
    write(root, { ".verify/acceptance.md": "- A1 another change\n", "src/math.mjs": read(root, "src/math.mjs") + "//y\n" });
    node("run-verify.mjs", [], { cwd: root });
    assert.match(brief(root).stdout, /round 1 of/);
  });
});

describe("pre-existing findings", () => {
  it("do not keep the Stop gate closed", () => {
    const root = project();
    addFeature(root);
    verify(root);
    write(root, { ".verify/review-backend.md": read(root, ".verify/review-backend.md").replace("- Note · none", "- Pre-existing · src/db.mjs:3 · unbounded query") });
    node("make-evidence.mjs", [], { cwd: root });
    assert.equal(gate(root), null);
  });
});

