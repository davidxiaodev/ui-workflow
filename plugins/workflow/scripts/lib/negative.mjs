// The negative check: proves the tests can fail. It runs the lane's test command twice, once on the
// current code (must pass) and once with only the lane's source changes taken back to the base commit
// while the changed tests stay (must fail). A test suite that still passes without the change does not
// test the change.
//
// It edits the working tree in place, so it backs every file up first, restores in a finally block,
// and refuses to start while an older backup exists (a crashed run): `run-verify.mjs --restore`.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gitLines, inLane, matchAny } from "./verify-config.mjs";

const BACKUP = "negative-backup";

export function backupExists(dir) {
  return existsSync(join(dir, BACKUP, "manifest.json"));
}

export function restore(dir, root) {
  const manifestPath = join(dir, BACKUP, "manifest.json");
  if (!existsSync(manifestPath)) return 0;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const f of manifest.files) {
    const target = join(root, f.path);
    if (f.existed) {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(dir, BACKUP, "files", f.path), target);
    } else if (existsSync(target)) unlinkSync(target);
  }
  rmSync(join(dir, BACKUP), { recursive: true, force: true });
  return manifest.files.length;
}

/**
 * @returns {{ exitCode: number, note: string, log: string }}
 */
export function runNegative({ root, dir, lane, tests, spec, timeoutMs, env }) {
  const test = typeof spec === "string" ? spec : spec.test;
  if (!test) return { exitCode: 2, note: 'negative check has no "test" command', log: "" };
  if (backupExists(dir)) {
    return {
      exitCode: 2,
      note: "a previous negative run left a backup; run run-verify.mjs --restore, check the working tree, then rerun",
      log: "",
    };
  }

  const base = resolveBase(root, spec.base);
  if (!base) return { exitCode: 2, note: "no base commit to compare with (no commits yet?)", log: "" };
  const changed = changedSince(root, base).filter((c) => inLane(lane, c.path));
  const isTest = (p) => matchAny(spec.tests ?? tests, p);
  const sources = changed.filter((c) => !isTest(c.path));
  const changedTests = changed.filter((c) => isTest(c.path));
  const log = [`base ${base}`, `source changes: ${sources.map((s) => s.path).join(", ") || "none"}`, `test changes: ${changedTests.map((s) => s.path).join(", ") || "none"}`, ""];

  if (sources.length === 0) return { exitCode: 0, note: "skipped: no source change in this lane", log: log.join("\n") };
  if (changedTests.length === 0) {
    return {
      exitCode: 0,
      note: "skipped: source changed but no test changed (fine for a refactor; for new behaviour the reviewer asks for a test)",
      log: log.join("\n"),
    };
  }

  const run = (label) => {
    const r = spawnSync(test, { cwd: root, shell: true, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 << 20, env });
    const code = r.status ?? (r.signal ? 124 : 1);
    log.push(`== ${label}: $ ${test} → exit ${code}`, r.stdout ?? "", r.stderr ?? "", "");
    return code;
  };

  const current = run("current code (must pass)");
  if (current !== 0) return { exitCode: 1, note: "the tests fail on the current code, so a failure without the change proves nothing", log: log.join("\n") };

  const backupDir = join(dir, BACKUP);
  const manifest = { base, startedAt: new Date().toISOString(), files: [] };
  let reverted;
  mkdirSync(backupDir, { recursive: true });
  try {
    for (const s of sources) {
      const target = join(root, s.path);
      const existed = existsSync(target);
      if (existed) {
        const copy = join(backupDir, "files", s.path);
        mkdirSync(dirname(copy), { recursive: true });
        copyFileSync(target, copy);
      }
      manifest.files.push({ path: s.path, existed });
      writeFileSync(join(backupDir, "manifest.json"), JSON.stringify(manifest, null, 2));
      const old = baseContent(root, base, s.path);
      if (old === null) {
        if (existed) unlinkSync(target);
      } else {
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, old);
      }
    }
    reverted = run("source taken back to base, tests kept (must fail)");
  } finally {
    restore(dir, root);
  }

  if (reverted === 0) {
    return {
      exitCode: 1,
      note: "the changed tests still pass without the source change: they do not test it",
      log: log.join("\n"),
    };
  }
  return {
    exitCode: 0,
    note: `tests failed without the change (exit ${reverted}); the reviewer reads the log to see they failed on an assertion, not only on a missing import`,
    log: log.join("\n"),
  };
}

function resolveBase(root, wanted) {
  const candidates = wanted ? [wanted] : ["origin/HEAD", "origin/main", "origin/master"];
  for (const ref of candidates) {
    const mb = gitLines(root, ["merge-base", "HEAD", ref])[0];
    if (mb) return mb;
  }
  return gitLines(root, ["rev-parse", "HEAD"])[0] ?? null;
}

/** Files that differ between base and the working tree, including untracked ones. */
function changedSince(root, base) {
  const out = new Map();
  for (const line of gitLines(root, ["diff", "--name-status", "--no-renames", base])) {
    const [status, path] = line.split("\t");
    out.set(path, { path, status });
  }
  for (const path of gitLines(root, ["ls-files", "--others", "--exclude-standard"])) out.set(path, { path, status: "A" });
  return [...out.values()];
}

function baseContent(root, base, path) {
  try {
    return execFileSync("git", ["show", `${base}:${path}`], { cwd: root, maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}
