// Shared by run-verify, stop-gate and make-evidence: reads .verify/config.json, matches files to
// lanes, and lists what changed. A lane is one surface with its own files, checks and reviewer
// (kind "frontend" uses design-review.md, kind "backend" uses code-review.md).
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

export const VERIFY_DIR = ".verify";

// Paths a lane ignores unless its config says otherwise: test code and verification output.
const FRONTEND_FILES = ["**/*.{tsx,jsx,vue,svelte,html,css,scss}"];
// React Native / Expo: all app code is UI code, and native config ships with the store build.
const RN_FILES = ["**/*.{ts,tsx,js,jsx}", "app.json", "app.config.{js,ts}", "eas.json", "ios/**", "android/**", "assets/**"];
const RN_NATIVE = ["app.json", "app.config.{js,ts}", "eas.json", "ios/**", "android/**"];
const FRONTEND_IGNORE = [
  "**/e2e/**",
  "**/test/**",
  "**/tests/**",
  "**/__tests__/**",
  "**/*-snapshots/**",
  "**/*.{test,spec,e2e,stories}.*",
];
export const DEFAULT_TESTS = [
  "**/test/**",
  "**/tests/**",
  "**/__tests__/**",
  "**/e2e/**",
  "**/*.{test,spec,e2e}.*",
  "**/*_test.*",
  "**/test_*.py",
  "**/*-snapshots/**",
];

export const CONFIG_PATH = `${VERIFY_DIR}/config.json`;

/**
 * Returns { root, dir, config, lanes, tests, source, base, workingDiffers } or null when the project has no config.
 *
 * The config is read from the base commit (the merge-base with the default branch) when it exists
 * there, because a change must not be able to edit the checks that judge it. `source: "working"`
 * reads the working copy instead (run-verify --config working, for a change that sets up or extends
 * the checks); such a change is a guarded change and lands in merge tier 3 anyway.
 */
export function loadConfig(root, { source = "base", base } = {}) {
  const workingPath = join(root, CONFIG_PATH);
  const workingText = existsSync(workingPath) ? readFileSync(workingPath, "utf8") : null;
  const baseRef = base ?? resolveBase(root);
  const baseText = baseRef ? gitShow(root, baseRef, CONFIG_PATH) : null;
  const useBase = source !== "working" && baseText !== null;
  const text = useBase ? baseText : workingText;
  if (text === null) return null;
  const config = JSON.parse(text);
  const lanes = Object.entries(config.lanes ?? {}).map(([name, lane]) => {
    const kind = lane.kind ?? name;
    const platform = kind === "frontend" ? (lane.platform ?? "web") : null;
    const rn = platform === "react-native";
    return {
      ...lane,
      name,
      kind,
      platform,
      files: lane.files ?? (kind === "frontend" ? (rn ? RN_FILES : FRONTEND_FILES) : []),
      ignore: [...(lane.ignore ?? (kind === "frontend" ? [...FRONTEND_IGNORE, ...(rn ? ["**/.maestro/**", "**/node_modules/**"] : [])] : [])), `${VERIFY_DIR}/**`],
      native: lane.native ?? (rn ? RN_NATIVE : []),
      checks: lane.checks ?? [],
    };
  });
  return {
    root,
    dir: join(root, VERIFY_DIR),
    config,
    lanes,
    tests: config.tests ?? DEFAULT_TESTS,
    guard: [...DEFAULT_GUARD, ...(config.guard ?? [])],
    source: useBase ? "base" : "working",
    base: baseRef,
    workingDiffers: workingText !== null && baseText !== null && normalizeJson(workingText) !== normalizeJson(baseText),
  };
}

function normalizeJson(text) {
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return text;
  }
}

/** True when the file belongs to the lane: matches one of its files globs and none of its ignore globs. */
export function inLane(lane, file) {
  return matchAny(lane.files, file) && !matchAny(lane.ignore, file);
}

export function contractPaths(lane) {
  const own = lane.kind === "frontend" ? ["docs/design.md"] : lane.kind === "backend" ? ["docs/backend.md"] : [];
  return [...own, ...(lane.tokens ?? []), ...(lane.contract ?? []), ...(lane.migrations ?? [])];
}

export function matchAny(globs, file) {
  return (globs ?? []).some((g) => globToRegExp(g).test(file));
}

const cache = new Map();
/** Globs: `**` any depth, `*` within one segment, `?` one character, `{a,b}` alternatives. A pattern with no glob characters also matches everything under it as a folder. */
export function globToRegExp(glob) {
  if (cache.has(glob)) return cache.get(glob);
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") {
        i++;
        re += "(?:.*/)?";
      } else re += ".*";
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{") re += "(?:";
    else if (c === "}") re += ")";
    else if (c === ",") re += glob.slice(0, i).lastIndexOf("{") > glob.slice(0, i).lastIndexOf("}") ? "|" : ",";
    else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  const plain = !/[*?{]/.test(glob);
  const out = new RegExp(`^${re.replace(/\/$/, "")}${plain ? "(?:/.*)?" : ""}$`);
  cache.set(glob, out);
  return out;
}

/** Uncommitted changes in the working tree (modified, added, untracked), as repo-relative paths. Deleted files are left out. */
export function workingChanges(root) {
  return gitLines(root, ["status", "--porcelain", "--untracked-files=all"])
    .map((l) => l.slice(3).split(" -> ").pop().replace(/^"|"$/g, ""))
    .filter((f) => existsSync(join(root, f)));
}

/** The commit a change is measured against: VERIFY_BASE, else the merge-base with the default branch, else HEAD. */
export function resolveBase(root, wanted = process.env.VERIFY_BASE) {
  const candidates = wanted ? [wanted] : ["origin/HEAD", "origin/main", "origin/master"];
  for (const ref of candidates) {
    const mb = gitLines(root, ["merge-base", "HEAD", ref])[0];
    if (mb) return mb;
  }
  return gitLines(root, ["rev-parse", "--verify", "HEAD"])[0] ?? null;
}

/**
 * Every file that differs between the base commit and the working tree: committed on this branch,
 * staged, unstaged or untracked, deletions included. [{ path, status }] with status A, M or D.
 */
export function changedSince(root, base = resolveBase(root)) {
  const out = new Map();
  if (base) {
    for (const line of gitLines(root, ["diff", "--name-status", "--no-renames", base])) {
      const [status, path] = line.split("\t");
      out.set(path, { path, status: status[0] });
    }
  }
  for (const path of gitLines(root, ["ls-files", "--others", "--exclude-standard"])) out.set(path, { path, status: "A" });
  return [...out.values()];
}

/**
 * A hash of the working tree's content (tracked and untracked files, deletions, not .gitignored
 * files, not .verify/). A run, a review and an evidence pack record it; when the content changes, so
 * does the hash, whatever the file times say. Uses a copy of the real index so unchanged files are
 * not re-read.
 */
export function treeHash(root) {
  const tmp = mkdtempSync(join(tmpdir(), "verify-index-"));
  const index = join(tmp, "index");
  try {
    const realIndex = gitLines(root, ["rev-parse", "--git-path", "index"])[0];
    const realPath = realIndex && (isAbsolute(realIndex) ? realIndex : join(root, realIndex));
    const env = { ...process.env, GIT_INDEX_FILE: index };
    if (realPath && existsSync(realPath)) copyIndex(realPath, index);
    else execFileSync("git", ["read-tree", "--empty"], { cwd: root, env, stdio: "ignore" });
    execFileSync("git", ["add", "-A", "--", ".", `:(exclude)${VERIFY_DIR}`], { cwd: root, env, stdio: "ignore" });
    execFileSync("git", ["rm", "-r", "--cached", "--quiet", "--ignore-unmatch", "--", VERIFY_DIR], { cwd: root, env, stdio: "ignore" });
    return execFileSync("git", ["write-tree"], { cwd: root, env, encoding: "utf8" }).trim();
  } catch {
    return null;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Copies git's index keeping its timestamps. Git trusts a cached file's stat data only when the file
 * is older than the index; a copy made now would look newer than every file, so an edit in the same
 * second as the last index write that keeps the size (`a + b` → `a - b`) would be read as unchanged.
 */
function copyIndex(from, to) {
  copyFileSync(from, to);
  const st = statSync(from);
  utimesSync(to, st.atime, st.mtime);
}

/** The hash of what the next commit would contain (the staged index), without .verify/: comparable with treeHash. */
export function indexTreeHash(root) {
  const tmp = mkdtempSync(join(tmpdir(), "verify-index-"));
  const index = join(tmp, "index");
  try {
    const realIndex = gitLines(root, ["rev-parse", "--git-path", "index"])[0];
    const realPath = realIndex && (isAbsolute(realIndex) ? realIndex : join(root, realIndex));
    const env = { ...process.env, GIT_INDEX_FILE: index };
    if (realPath && existsSync(realPath)) copyIndex(realPath, index);
    else execFileSync("git", ["read-tree", "--empty"], { cwd: root, env, stdio: "ignore" });
    execFileSync("git", ["rm", "-r", "--cached", "--quiet", "--ignore-unmatch", "--", VERIFY_DIR], { cwd: root, env, stdio: "ignore" });
    return execFileSync("git", ["write-tree"], { cwd: root, env, encoding: "utf8" }).trim();
  } catch {
    return null;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Files that define how a change is judged. A change to one of them is a change to the checks
// themselves, so it is never verified by those checks alone: it lands in merge tier 3.
export const DEFAULT_GUARD = [
  CONFIG_PATH,
  "docs/checklist.md",
  ".claude/settings.json",
  ".claude/settings.local.json",
  ".claude/hooks/**",
  ".github/workflows/**",
  ".github/CODEOWNERS",
  ".husky/**",
  "**/.pre-commit-config.yaml",
  "**/playwright.config.*",
  "**/vitest.config.*",
  "**/vitest.workspace.*",
  "**/jest.config.*",
  "**/cypress.config.*",
  "**/eslint.config.*",
  "**/.eslintrc*",
  "**/biome.json",
  "**/biome.jsonc",
  "**/tsconfig*.json",
  "**/.stylelintrc*",
  "**/pytest.ini",
  "**/conftest.py",
  "**/.golangci.y*ml",
  "**/scripts/ui/check-raw-styles.mjs",
  "**/scripts/ui/rn-look.mjs",
  "**/scripts/ui/lib/png.mjs",
  "**/e2e/rn-look/screens.json",
  "**/e2e/ui-look/**/*.{ts,js,json}",
];

// Lines in a test file that switch a test off, focus a run on a few tests, or loosen a visual
// comparison: tier 3. Lines anywhere that silence a type or lint check, or retry and wait longer:
// tier 2, because they are common and often fine, but a person should see them.
const WEAKENING_TESTS = [
  [/\b(?:it|test|describe|context|suite)\.(?:skip|only|todo|fixme)\s*\(/, "skips or focuses tests"],
  [/\b(?:xit|xdescribe|xtest|fit|fdescribe)\s*\(/, "skips or focuses tests"],
  [/@pytest\.mark\.(?:skip|skipif|xfail)\b|@unittest\.skip|pytest\.skip\(/, "skips tests"],
  [/\bt\.Skip(?:Now|f)?\(|#\[ignore\]/, "skips tests"],
  [/\b(?:maxDiffPixels|maxDiffPixelRatio|threshold)\s*:/, "loosens a screenshot comparison"],
  [/\bmask\s*:\s*\[/, "masks part of a screenshot"],
];
const SILENCING = [
  [/@ts-(?:ignore|nocheck|expect-error)\b|eslint-disable|biome-ignore|#\s*type:\s*ignore|#\s*noqa\b|\/\/\s*nolint\b/, "silences a type or lint check"],
  [/\b(?:retries|retry)\s*[:=(]\s*\d/, "adds retries"],
];

/**
 * Changes that weaken or redefine the checks. [{ path, why, tier }]
 * - tier 3: a guard file changed or was deleted, a test file was deleted, or a test file gained a
 *   line that skips, focuses or loosens a check;
 * - tier 2: any changed file gained a line that silences a type or lint check, or adds retries.
 */
export function guardChanges(cfg, changes = changedSince(cfg.root, cfg.base)) {
  const out = [];
  const isTest = (p) => matchAny(cfg.tests, p);
  const isGuard = (p) => matchAny(cfg.guard, p);
  for (const c of changes) {
    if (isGuard(c.path)) out.push({ path: c.path, why: c.status === "D" ? "check file deleted" : "check or tool config changed", tier: 3 });
    else if (c.status === "D" && isTest(c.path)) out.push({ path: c.path, why: "test file deleted", tier: 3 });
  }
  const added = addedLinesByFile(cfg.root, cfg.base);
  for (const c of changes.filter((c) => c.status !== "D" && !isGuard(c.path) && !c.path.startsWith(`${VERIFY_DIR}/`))) {
    const lines = added.get(c.path) ?? readLines(join(cfg.root, c.path));
    const rules = [...(isTest(c.path) ? WEAKENING_TESTS.map((r) => [...r, 3]) : []), ...SILENCING.map((r) => [...r, 2])];
    const seen = new Set();
    for (const [re, why, tier] of rules) {
      if (seen.has(why) || !lines.some((l) => re.test(l))) continue;
      seen.add(why);
      out.push({ path: c.path, why: `${isTest(c.path) ? "a test" : "the code"} ${why}`, tier });
    }
  }
  return out;
}

/** Lines added since base, per tracked file, from one diff. Untracked files are not in it. */
function addedLinesByFile(root, base) {
  const out = new Map();
  if (!base) return out;
  let current = null;
  for (const line of gitLines(root, ["diff", "--unified=0", "--no-renames", "--no-color", base])) {
    if (line.startsWith("+++ ")) {
      current = line === "+++ /dev/null" ? null : line.slice(6);
      if (current && !out.has(current)) out.set(current, []);
    } else if (current && line.startsWith("+")) out.get(current).push(line.slice(1));
  }
  return out;
}

function readLines(file) {
  try {
    return readFileSync(file, "utf8").split("\n");
  } catch {
    return [];
  }
}

/** A file's content at a commit (a string, or a Buffer with { buffer: true }), or null when it does not exist there. */
export function gitShow(root, ref, path, { buffer = false } = {}) {
  try {
    return execFileSync("git", ["show", `${ref}:${path}`], { cwd: root, ...(buffer ? {} : { encoding: "utf8" }), maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

export function gitLines(root, argv) {
  try {
    return execFileSync("git", argv, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function gitRoot(cwd) {
  return gitLines(cwd, ["rev-parse", "--show-toplevel"])[0] ?? null;
}

export function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/** Criteria ids (A1, A2, …) declared in .verify/acceptance.md. */
export function acceptanceIds(text) {
  return [...new Set([...text.matchAll(/^\s*-\s*(?:\[[ x-]\]\s*)?(A\d+)\b/gim)].map((m) => m[1].toUpperCase()))];
}

/** Lines under a review's "## Acceptance" heading. */
export function acceptanceLines(reviewText) {
  const out = [];
  let inside = false;
  for (const line of reviewText.split("\n")) {
    if (/^##\s/.test(line)) inside = /^##\s+Acceptance\b/i.test(line);
    else if (inside && /^\s*-\s/.test(line)) out.push(line);
  }
  return out;
}

export const OPEN_LINE = (l) => /^\s*-\s*\[ \]/.test(l) || /^\s*(?:-\s*)?FAIL\b/.test(l);
