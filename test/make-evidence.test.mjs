import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { treeHash } from "../plugins/workflow/scripts/lib/verify-config.mjs";
import { addFeature, cleanup, CONFIG, evidenceText, git, makeProject, node, read, tierOf, verify, write } from "./helpers.mjs";

const roots = [];
const project = (opts) => {
  const r = makeProject(opts);
  roots.push(r);
  return r;
};
after(() => roots.forEach(cleanup));

describe("make-evidence merge tier", () => {
  it("tier 1 for a verified, contained change, naming the tree", () => {
    const root = project();
    addFeature(root);
    verify(root);
    assert.equal(tierOf(root), "1");
    assert.match(evidenceText(root), new RegExp(`^Tree: ${treeHash(root)}$`, "m"));
  });

  it("counts commits already pushed on the branch as part of the change", () => {
    const root = project({ config: { ...CONFIG, lanes: { api: { ...CONFIG.lanes.api, contract: ["openapi.yaml"] } } }, files: { "openapi.yaml": "v1\n" } });
    addFeature(root);
    write(root, { "openapi.yaml": "v2\n" });
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "feature");
    git(root, "push", "-q", "-u", "origin", "feature");
    verify(root);
    assert.equal(tierOf(root), "3");
    assert.match(evidenceText(root), /Contract changes: `openapi.yaml`/);
  });

  it("tier 3 when the checks themselves changed", () => {
    const root = project();
    addFeature(root);
    write(root, { ".verify/config.json": JSON.stringify({ ...CONFIG, tests: ["test/**"] }) });
    verify(root, { runArgs: ["--config", "working"] });
    assert.equal(tierOf(root), "3");
    assert.match(evidenceText(root), /the checks themselves changed \(\.verify\/config\.json/);
  });

  it("tier 3 when a test file was deleted", () => {
    const root = project();
    addFeature(root);
    rmSync(join(root, "test/other.test.mjs"));
    verify(root);
    assert.equal(tierOf(root), "3");
    assert.match(evidenceText(root), /test\/other\.test\.mjs: test file deleted/);
  });

  it("tier 2 when the code silences a check", () => {
    const root = project();
    addFeature(root);
    write(root, { "src/math.mjs": "// @ts-expect-error\n" + read(root, "src/math.mjs") });
    verify(root);
    assert.equal(tierOf(root), "2");
  });

  it("not ready when the review is of another tree", () => {
    const root = project();
    addFeature(root);
    verify(root, { reviewTree: "0123456789ab" });
    assert.equal(tierOf(root), "not ready");
    assert.match(evidenceText(root), /verified a different tree than the one on disk \(review api\)/);
  });

  it("prints a PR body with the check changes and the tree", () => {
    const root = project();
    addFeature(root);
    verify(root);
    const pr = node("make-evidence.mjs", ["--pr"], { cwd: root });
    assert.match(pr.stdout, /Check changes: none/);
    assert.match(pr.stdout, /Verified tree: `[0-9a-f]{12}`/);
  });
});
