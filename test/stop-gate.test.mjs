import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { addFeature, cleanup, gate, git, makeProject, node, read, verify, write } from "./helpers.mjs";

const roots = [];
const project = (opts) => {
  const r = makeProject(opts);
  roots.push(r);
  return r;
};
after(() => roots.forEach(cleanup));
const gateLog = (root) =>
  read(root, ".verify/gate.log")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

describe("stop gate", () => {
  it("lets a turn end when no lane file changed", () => {
    const root = project();
    write(root, { "README.md": "docs\n" });
    assert.equal(gate(root), null);
  });

  it("blocks an unverified lane change", () => {
    const root = project();
    addFeature(root);
    const d = gate(root);
    assert.equal(d.decision, "block");
    assert.match(d.reason, /run-verify has not run this lane/);
  });

  it("lets a fully verified change end, and blocks again after an edit", () => {
    const root = project();
    addFeature(root);
    const { run, evidence } = verify(root);
    assert.equal(run.code, 0, run.stdout);
    assert.equal(evidence.code, 0, evidence.stderr);
    assert.equal(gate(root), null);
    write(root, { "src/math.mjs": read(root, "src/math.mjs") + "// later edit\n" });
    const d = gate(root);
    assert.match(d.reason, /files changed since the last run-verify/);
    assert.match(d.reason, /its review is of tree/);
  });

  it("does not trust file times: touching nothing but re-saving the same content still passes", () => {
    const root = project();
    addFeature(root);
    verify(root);
    write(root, { "src/math.mjs": read(root, "src/math.mjs") });
    assert.equal(gate(root), null);
  });

  it("blocks a review that names another tree or none", () => {
    const root = project();
    addFeature(root);
    verify(root, { reviewTree: "0123456789ab" });
    assert.match(gate(root).reason, /its review is of tree 0123456789ab/);
    write(root, { ".verify/review-api.md": read(root, ".verify/review-api.md").replace(/^Tree:.*\n/m, "") });
    assert.match(gate(root).reason, /has no "Tree:" line/);
  });

  it("still checks a change that was committed during the turn", () => {
    const root = project();
    addFeature(root);
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "feature");
    assert.equal(gate(root).decision, "block");
  });

  it("checks a deleted lane file", () => {
    const root = project();
    rmSync(join(root, "test/other.test.mjs"));
    assert.equal(gate(root).decision, "block");
  });

  it("leaves a turn alone that changed nothing since it started", () => {
    const root = project();
    addFeature(root);
    node("turn-start.mjs", [], { cwd: root, input: { cwd: root } });
    assert.equal(gate(root), null);
    write(root, { "src/math.mjs": read(root, "src/math.mjs") + "// edit in this turn\n" });
    assert.equal(gate(root).decision, "block");
  });

  it("lets the second stop through and logs it", () => {
    const root = project();
    addFeature(root);
    assert.equal(gate(root, { stop_hook_active: true }), null);
    assert.equal(gateLog(root).at(-1).decision, "let-through-unverified");
  });

  it("only logs in observe mode, and does nothing when off", () => {
    const root = project();
    addFeature(root);
    assert.equal(gate(root, {}, { UI_WORKFLOW_GATE: "observe" }), null);
    assert.equal(gateLog(root).at(-1).decision, "would-block");
    assert.equal(gate(root, {}, { UI_WORKFLOW_GATE: "off" }), null);
    assert.equal(gateLog(root).length, 1);
  });

  it("does not accept a weakened working config as the lane definition", () => {
    const root = project();
    addFeature(root);
    write(root, { ".verify/config.json": JSON.stringify({ lanes: { api: { files: ["nothing/**"], checks: [] } } }) });
    assert.equal(gate(root).decision, "block");
  });
});
