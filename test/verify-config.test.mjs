import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { changedSince, globToRegExp, guardChanges, loadConfig, treeHash } from "../plugins/dx-workflow/scripts/lib/verify-config.mjs";
import { cleanup, CONFIG, git, makeProject, write } from "./helpers.mjs";

const roots = [];
const project = (opts) => {
  const r = makeProject(opts);
  roots.push(r);
  return r;
};
after(() => roots.forEach(cleanup));

describe("globToRegExp", () => {
  it("matches any depth, one segment and alternatives", () => {
    assert.ok(globToRegExp("src/**").test("src/a/b.ts"));
    assert.ok(globToRegExp("**/*.{ts,tsx}").test("a/b/c.tsx"));
    assert.ok(!globToRegExp("src/*.ts").test("src/a/b.ts"));
    assert.ok(globToRegExp(".verify/config.json").test(".verify/config.json"));
  });
});

describe("changedSince", () => {
  it("sees commits on the branch, untracked files and deletions", () => {
    const root = project();
    write(root, { "src/committed.mjs": "1\n" });
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "on branch");
    write(root, { "src/untracked.mjs": "1\n" });
    rmSync(join(root, "test/other.test.mjs"));
    const byPath = Object.fromEntries(changedSince(root).map((c) => [c.path, c.status]));
    assert.equal(byPath["src/committed.mjs"], "A");
    assert.equal(byPath["src/untracked.mjs"], "A");
    assert.equal(byPath["test/other.test.mjs"], "D");
  });
});

describe("treeHash", () => {
  it("changes with content and deletions, not with .verify/ or ignored files", () => {
    const root = project();
    const t0 = treeHash(root);
    assert.match(t0, /^[0-9a-f]{40}$/);
    assert.equal(treeHash(root), t0);
    write(root, { ".verify/last-run.json": "{}", "node_modules/x.js": "1" });
    assert.equal(treeHash(root), t0, ".verify and ignored files do not count");
    write(root, { "src/math.mjs": "export const add = (a, b) => b + a;\n" });
    const t1 = treeHash(root);
    assert.notEqual(t1, t0);
    rmSync(join(root, "test/other.test.mjs"));
    assert.notEqual(treeHash(root), t1);
    assert.equal(git(root, "status", "--porcelain").includes("A "), false, "the real index is untouched");
  });
});

describe("treeHash and racy edits", () => {
  const second = () => Math.floor(Date.now() / 1000);
  const waitNextSecond = () => {
    const s0 = second();
    while (second() === s0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  };
  // Ground truth: hash the working tree from an empty index, with no cached stat data to trust.
  const freshHash = (root) => {
    const env = { ...process.env, GIT_INDEX_FILE: join(root, ".git", "fresh-index") };
    const run = (...a) => execFileSync("git", a, { cwd: root, env, encoding: "utf8" }).trim();
    run("read-tree", "--empty");
    run("add", "-A", "--", ".", ":(exclude).verify");
    const t = run("write-tree");
    rmSync(env.GIT_INDEX_FILE);
    return t;
  };

  it("sees a same-size edit made in the same second as the last index write, hashed a second later", () => {
    let tried = 0;
    for (let i = 0; i < 6 && tried < 3; i++) {
      waitNextSecond();
      const s0 = second();
      const root = project();
      write(root, { "src/math.mjs": "export const add = (a, b) => a - b;\n" }); // same length as a + b
      if (second() !== s0) continue; // commit and edit straddled a second: not the racy case
      tried++;
      waitNextSecond();
      assert.equal(treeHash(root), freshHash(root), "the same-size edit was invisible to treeHash");
    }
    assert.ok(tried > 0, "could not set up the racy case");
  });
});

describe("loadConfig", () => {
  it("reads the base commit's config, and says when the working copy differs", () => {
    const root = project();
    write(root, { ".verify/config.json": JSON.stringify({ lanes: { backend: { files: ["src/**"], checks: [] } } }) });
    const cfg = loadConfig(root);
    assert.equal(cfg.source, "base");
    assert.equal(cfg.workingDiffers, true);
    assert.equal(cfg.lanes[0].checks.length, 2);
    const working = loadConfig(root, { source: "working" });
    assert.equal(working.source, "working");
    assert.equal(working.lanes[0].checks.length, 0);
  });

  it("uses the working copy when the base has no config", () => {
    const root = project();
    git(root, "rm", "-q", "--cached", ".verify/config.json");
    git(root, "commit", "-q", "-m", "drop config");
    git(root, "push", "-q", "origin", "feature:main", "--force");
    git(root, "fetch", "-q", "origin");
    const cfg = loadConfig(root);
    assert.equal(cfg.source, "working");
    assert.deepEqual(cfg.lanes.map((l) => l.name), ["backend"]);
  });
});

describe("guardChanges", () => {
  const guards = (root) => guardChanges(loadConfig(root)).map((g) => `${g.tier} ${g.path}: ${g.why}`);

  it("is empty for an ordinary change with a new test", () => {
    const root = project();
    write(root, { "src/math.mjs": "export const add = (a, b) => a + b + 0;\n", "test/new.test.mjs": "await page.waitFor({ timeout: 5000 });\n" });
    assert.deepEqual(guards(root), []);
  });

  it("flags the config, deleted tests and skipped tests as tier 3", () => {
    const root = project();
    write(root, {
      ".verify/config.json": JSON.stringify({ ...CONFIG, lanes: { backend: { ...CONFIG.lanes.backend, checks: [] } } }),
      "test/run.mjs": "it.skip('adds', () => {});\n",
      "playwright.config.ts": "export default {};\n",
    });
    rmSync(join(root, "test/other.test.mjs"));
    const g = guards(root);
    assert.ok(g.includes("3 .verify/config.json: check or tool config changed"), g.join("\n"));
    assert.ok(g.includes("3 test/other.test.mjs: test file deleted"), g.join("\n"));
    assert.ok(g.includes("3 test/run.mjs: a test skips or focuses tests"), g.join("\n"));
    assert.ok(g.includes("3 playwright.config.ts: check or tool config changed"), g.join("\n"));
  });

  it("flags silenced checks in source as tier 2", () => {
    const root = project();
    write(root, { "src/math.mjs": "// @ts-ignore\nexport const add = (a, b) => a + b;\n" });
    assert.deepEqual(guards(root), ["2 src/math.mjs: the code silences a type or lint check"]);
  });

  it("looks only at added lines of files that existed on the base", () => {
    const root = project({ files: { "src/legacy.mjs": "// eslint-disable-next-line\nexport const x = 1;\n" } });
    write(root, { "src/legacy.mjs": "// eslint-disable-next-line\nexport const x = 2;\n" });
    assert.deepEqual(guards(root), []);
  });
});
