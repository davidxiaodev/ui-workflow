import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { treeHash } from "../plugins/dx-workflow/scripts/lib/verify-config.mjs";
import { addFeature, cleanup, makeProject, node, read, write } from "./helpers.mjs";

const roots = [];
const project = (opts) => {
  const r = makeProject(opts);
  roots.push(r);
  return r;
};
after(() => roots.forEach(cleanup));
const lastRun = (root) => JSON.parse(read(root, ".verify/last-run.json"));

describe("run-verify", () => {
  it("records a pass with the tree it checked and where the config came from", () => {
    const root = project();
    addFeature(root);
    const r = node("run-verify.mjs", [], { cwd: root });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const last = lastRun(root);
    assert.equal(last.lanes.backend.result, "pass");
    assert.equal(last.lanes.backend.tree, treeHash(root));
    assert.equal(last.config.source, "base");
    assert.match(last.lanes.backend.checks.find((c) => c.name === "negative").note, /tests failed without the change/);
  });

  it("runs the base's checks when the change removes them from the working config", () => {
    const root = project();
    write(root, {
      ".verify/config.json": JSON.stringify({ lanes: { backend: { files: ["src/**"], checks: [{ name: "unit", run: "node -e 0" }] } } }),
      "src/math.mjs": "export const add = (a, b) => a - b;\n",
    });
    const r = node("run-verify.mjs", [], { cwd: root });
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stdout, /differs from the base commit; running the base's checks/);
    const wk = node("run-verify.mjs", ["--config", "working"], { cwd: root });
    assert.equal(wk.code, 0, wk.stdout);
    assert.equal(lastRun(root).config.source, "working");
  });

  it("fails a run whose checks wrote to the source", () => {
    const root = project({
      config: { lanes: { backend: { files: ["src/**"], checks: [{ name: "format", run: "node -e \"require('fs').appendFileSync('src/math.mjs', '\\n')\"" }] } } },
    });
    const r = node("run-verify.mjs", [], { cwd: root });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /files changed while the checks ran/);
    assert.equal(lastRun(root).lanes.backend.result, "fail");
  });

  it("refuses to run while a crashed negative check left a backup, and restores it", () => {
    const root = project();
    write(root, { ".verify/negative-backup/manifest.json": JSON.stringify({ files: [{ path: "src/math.mjs", existed: true }] }), ".verify/negative-backup/files/src/math.mjs": "export const add = (a, b) => a + b; // original\n", "src/math.mjs": "reverted\n" });
    assert.equal(node("run-verify.mjs", [], { cwd: root }).code, 2);
    assert.equal(node("run-verify.mjs", ["--restore"], { cwd: root }).code, 0);
    assert.match(read(root, "src/math.mjs"), /original/);
    assert.equal(existsSync(join(root, ".verify/negative-backup")), false);
  });
});

describe("negative check", () => {
  it("fails when the changed tests pass without the source change", () => {
    const root = project();
    write(root, {
      "src/math.mjs": "export const add = (a, b) => a + b;\nexport const sub = (a, b) => a - b;\n",
      "test/run.mjs": read(root, "test/run.mjs") + "// touched\n",
    });
    const r = node("run-verify.mjs", ["--only", "negative"], { cwd: root });
    assert.equal(r.code, 1);
    assert.match(lastRun(root).lanes.backend.checks[0].note, /do not test it/);
  });

  it("puts the source back after reverting it, binary files included", () => {
    const root = project({ files: { "src/logo.bin": Buffer.from([0, 255, 1, 254, 128]) } });
    addFeature(root);
    write(root, { "src/logo.bin": Buffer.from([9, 200, 0, 7]) });
    const before = treeHash(root);
    const r = node("run-verify.mjs", ["--only", "negative"], { cwd: root });
    assert.equal(r.code, 0, r.stdout);
    assert.equal(treeHash(root), before);
  });

  it("only reports a source change that came with no test change", () => {
    const root = project();
    write(root, { "src/math.mjs": "export const add = (a, b) => b + a;\n" });
    node("run-verify.mjs", ["--only", "negative"], { cwd: root });
    assert.match(lastRun(root).lanes.backend.checks[0].note, /no test changed/);
  });
});

