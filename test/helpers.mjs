// Fixture projects for the script tests: a bare "origin" with a main branch, and a clone on a
// feature branch. The project has one backend lane whose unit test is a plain node script.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), "../plugins/dx-workflow/scripts");

const GIT_ENV = {
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
};

export const CONFIG = {
  lanes: {
    backend: {
      files: ["src/**", "test/**"],
      checks: [
        { name: "unit", run: "node test/run.mjs" },
        { name: "negative", negative: { test: "node test/run.mjs" } },
      ],
    },
  },
};

export function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...GIT_ENV }, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** A project committed on origin/main, checked out on branch "feature". Returns its path. */
export function makeProject({ config = CONFIG, files = {} } = {}) {
  const base = mkdtempSync(join(tmpdir(), "uiwf-"));
  const origin = join(base, "origin.git");
  const root = join(base, "project");
  git(base, "init", "-q", "--bare", "-b", "main", origin);
  mkdirSync(root);
  git(root, "init", "-q", "-b", "main");
  write(root, {
    ".gitignore": ".verify/*\n!.verify/config.json\nnode_modules/\n",
    ".verify/config.json": JSON.stringify(config, null, 2),
    "src/math.mjs": "export const add = (a, b) => a + b;\n",
    "test/run.mjs": 'import { add } from "../src/math.mjs";\nif (add(2, 2) !== 4) { console.error("add broken"); process.exit(1); }\nconsole.log("ok");\n',
    "test/other.test.mjs": "// another test file\n",
    ...files,
  });
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  git(root, "remote", "add", "origin", origin);
  git(root, "push", "-q", "origin", "main");
  git(root, "remote", "set-head", "origin", "main");
  git(root, "checkout", "-q", "-b", "feature");
  return root;
}

export function cleanup(root) {
  rmSync(dirname(root), { recursive: true, force: true });
}

export function write(root, files) {
  for (const [path, content] of Object.entries(files)) {
    const p = join(root, path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
}

export function read(root, path) {
  return readFileSync(join(root, path), "utf8");
}

export function node(script, args = [], { cwd, input, env = {} } = {}) {
  const r = spawnSync(process.execPath, [join(SCRIPTS, script), ...args], {
    cwd,
    input: input === undefined ? "" : typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, ...GIT_ENV, VERIFY_BASE: "", DX_WORKFLOW_GATE: "", ...env },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Runs the Stop gate; returns the parsed block decision or null when it let the turn end. */
export function gate(root, input = {}, env = {}) {
  const r = node("stop-gate.mjs", [], { cwd: root, input: { cwd: root, ...input }, env });
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

/** Feature change that adds behaviour plus a test that only passes with it. */
export function addFeature(root) {
  write(root, {
    "src/math.mjs": "export const add = (a, b) => a + b;\nexport const sub = (a, b) => a - b;\n",
    "test/run.mjs":
      'import * as m from "../src/math.mjs";\nif (m.add(2, 2) !== 4) { console.error("add broken"); process.exit(1); }\nif (typeof m.sub !== "function" || m.sub(5, 3) !== 2) { console.error("sub broken"); process.exit(1); }\nconsole.log("ok");\n',
  });
}

/** Everything the gate asks for: a passing run, acceptance, an approved review naming the run's tree, evidence. */
export function verify(root, { runArgs = [], reviewTree, lane = "backend" } = {}) {
  const run = node("run-verify.mjs", runArgs, { cwd: root });
  const last = JSON.parse(read(root, ".verify/last-run.json"));
  write(root, {
    ".verify/acceptance.md": "# Acceptance: sub\n## Criteria\n- A1 sub(5, 3) returns 2 · proof: test/run.mjs\n",
    [`.verify/review-${lane}.md`]: [
      `# Review ${last.lanes[lane].runDir}`,
      "Reviewer: test",
      `Tree: ${reviewTree ?? last.lanes[lane].tree}`,
      "",
      "## Acceptance",
      "- [x] A1 met · test/run.mjs passed",
      "",
      "## Findings",
      "- Note · none",
      "",
      "Verdict: approved",
      "",
    ].join("\n"),
  });
  const evidence = node("make-evidence.mjs", [], { cwd: root });
  return { run, evidence, last };
}

export function tierOf(root) {
  const last = JSON.parse(read(root, ".verify/last-run.json"));
  return /\*\*Merge tier: ([^.*]+)\.\*\*/.exec(readFileSync(join(last.runDir, "evidence.md"), "utf8"))?.[1];
}

export function evidenceText(root) {
  const last = JSON.parse(read(root, ".verify/last-run.json"));
  return readFileSync(join(last.runDir, "evidence.md"), "utf8");
}
