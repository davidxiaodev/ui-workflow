import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { addFeature, cleanup, CONFIG, evidenceText, git, makeProject, node, read, tierOf, verify, write } from "./helpers.mjs";

const roots = [];
const project = (opts) => {
  const r = makeProject(opts);
  roots.push(r);
  return r;
};
after(() => roots.forEach(cleanup));
const stamp = (root) => node("stamp.mjs", [], { cwd: root }).stdout.trim();

describe("run-verify fail-fast", () => {
  it("skips the rest of a lane after a failure, unless --keep-going", () => {
    const root = project({ config: { lanes: { backend: { files: ["src/**"], checks: [{ name: "a", run: "node -e process.exit(1)" }, { name: "b", run: "node -e 0" }] } } } });
    write(root, { "src/x.mjs": "1\n" });
    node("run-verify.mjs", [], { cwd: root });
    let checks = JSON.parse(read(root, ".verify/last-run.json")).lanes.backend.checks;
    assert.equal(checks[1].skipped, true);
    node("run-verify.mjs", ["--keep-going"], { cwd: root });
    checks = JSON.parse(read(root, ".verify/last-run.json")).lanes.backend.checks;
    assert.equal(checks[1].exitCode, 0);
  });
});

describe("commit stamp", () => {
  it("says none, then the tier, then none again when the commit differs", () => {
    const root = project();
    assert.equal(stamp(root), "", "no lane change, no trailer");
    addFeature(root);
    assert.equal(stamp(root), "Verified: none (no evidence pack)");
    verify(root);
    git(root, "add", "-A");
    assert.match(stamp(root), /^Verified: tree=[0-9a-f]{12} tier=1 lanes=backend:pass$/);
    write(root, { "src/math.mjs": read(root, "src/math.mjs") + "// staged later\n" });
    git(root, "add", "src/math.mjs");
    assert.equal(stamp(root), "Verified: none (the commit differs from the verified content)");
  });

  it("installs a hook that adds the trailer and never blocks", () => {
    const root = project();
    addFeature(root);
    verify(root);
    const r = node("stamp.mjs", ["--install"], { cwd: root });
    assert.equal(r.code, 0, r.stderr);
    const hook = join(root, ".git/hooks/prepare-commit-msg");
    assert.ok(statSync(hook).mode & 0o100);
    // The hook finds the plugin through .verify/plugin-root, which turn-start writes.
    node("turn-start.mjs", [], { cwd: root, input: { cwd: root } });
    assert.ok(existsSync(join(root, ".verify/plugin-root")));
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "add sub", "-m", "Co-Authored-By: x <x@example.com>");
    const msg = git(root, "log", "-1", "--format=%B");
    assert.match(msg, /Co-Authored-By: x <x@example.com>\nVerified: tree=[0-9a-f]{12} tier=1 lanes=backend:pass/);
    assert.equal(node("stamp.mjs", ["--install"], { cwd: root }).code, 0, "second install is a no-op");
  });
});

describe("make-evidence extras", () => {
  it("tier 3 for a sensitive path, with merge danger", () => {
    const root = project({ config: { ...CONFIG, lanes: { backend: { ...CONFIG.lanes.backend, sensitive: ["src/math.mjs"] } } } });
    addFeature(root);
    verify(root);
    assert.equal(tierOf(root), "3");
    const ev = evidenceText(root);
    assert.match(ev, /a sensitive path changed \(src\/math\.mjs\)/);
    assert.match(ev, /- Door: two-way/);
    assert.match(ev, /- Blast radius: wide: sensitive paths \(1\)/);
    assert.match(ev, /- How to revert: revert the commit/);
  });

  it("one-way door for a migration, and the acceptance's own revert note", () => {
    const root = project({ config: { ...CONFIG, lanes: { backend: { ...CONFIG.lanes.backend, files: ["src/**", "test/**", "migrations/**"], migrations: ["migrations/**"] } } } });
    addFeature(root);
    write(root, { "migrations/002.sql": "alter table t add column c int;\n" });
    verify(root);
    write(root, { ".verify/acceptance.md": read(root, ".verify/acceptance.md") + "Revert: turn off the sub flag\n" });
    node("make-evidence.mjs", [], { cwd: root });
    const ev = evidenceText(root);
    assert.match(ev, /- Door: one-way: a migration changes stored data \(migrations\/002\.sql\)/);
    assert.match(ev, /- How to revert: turn off the sub flag/);
  });

  it("checks-only mode for CI: no reviews needed, exit code on not ready", () => {
    const root = project();
    addFeature(root);
    assert.equal(node("run-verify.mjs", [], { cwd: root }).code, 0);
    const ok = node("make-evidence.mjs", ["--checks-only", "--exit-code"], { cwd: root });
    assert.equal(ok.code, 0, ok.stdout);
    assert.match(ok.stdout, /\*\*Merge tier: 1\.\*\* .*Checks only/);
    write(root, { "src/math.mjs": "export const add = () => 0;\n" });
    node("run-verify.mjs", [], { cwd: root });
    const bad = node("make-evidence.mjs", ["--checks-only", "--exit-code"], { cwd: root });
    assert.equal(bad.code, 1);
    assert.match(bad.stdout, /Merge tier: not ready/);
  });

  it("the PR body carries merge danger", () => {
    const root = project();
    addFeature(root);
    verify(root);
    assert.match(node("make-evidence.mjs", ["--pr"], { cwd: root }).stdout, /### Merge danger\n- Door: two-way/);
  });
});

