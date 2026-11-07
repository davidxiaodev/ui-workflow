// Shared by run-verify, stop-gate and make-evidence: reads .verify/config.json, matches files to
// lanes, and lists what changed. A lane is one surface with its own files, checks and reviewer
// ("ui" uses design-review.md, "api" uses code-review.md).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const VERIFY_DIR = ".verify";

// Paths a lane ignores unless its config says otherwise: test code and verification output.
const UI_FILES = ["**/*.{tsx,jsx,vue,svelte,html,css,scss}"];
const UI_IGNORE = [
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

/** Returns { root, dir, config, lanes: [{ name, kind, files, ignore, ... }] } or null when the project has no config. */
export function loadConfig(root) {
  const path = join(root, VERIFY_DIR, "config.json");
  if (!existsSync(path)) return null;
  const config = JSON.parse(readFileSync(path, "utf8"));
  const lanes = Object.entries(config.lanes ?? {}).map(([name, lane]) => {
    const kind = lane.kind ?? name;
    return {
      ...lane,
      name,
      kind,
      files: lane.files ?? (kind === "ui" ? UI_FILES : []),
      ignore: [...(lane.ignore ?? (kind === "ui" ? UI_IGNORE : [])), `${VERIFY_DIR}/**`],
      checks: lane.checks ?? [],
    };
  });
  return { root, dir: join(root, VERIFY_DIR), config, lanes, tests: config.tests ?? DEFAULT_TESTS };
}

export function legacyConfigExists(root) {
  return existsSync(join(root, ".ui-verify", "config.json")) && !existsSync(join(root, VERIFY_DIR, "config.json"));
}

/** True when the file belongs to the lane: matches one of its files globs and none of its ignore globs. */
export function inLane(lane, file) {
  return matchAny(lane.files, file) && !matchAny(lane.ignore, file);
}

export function contractPaths(lane) {
  const own = lane.kind === "ui" ? ["docs/design.md"] : lane.kind === "api" ? ["docs/backend.md"] : [];
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
