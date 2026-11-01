#!/usr/bin/env node
// Locates the third-party tools this workflow calls, wherever they were installed
// (Claude Code plugins, user or project skills). Prints JSON; a missing tool is null.
//
//   node find-tools.mjs [--root <project root>]
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const i = process.argv.indexOf("--root");
const root = resolve(i === -1 ? process.cwd() : process.argv[i + 1]);
const home = homedir();
const searchRoots = [
  join(home, ".claude", "plugins"),
  join(home, ".claude", "skills"),
  join(home, ".agents", "skills"),
  join(root, ".claude", "skills"),
  join(root, ".agents", "skills"),
].filter((p) => existsSync(p));

const wanted = {
  tasteDraw: /[\\/]taste-skill[\\/]scripts[\\/]draw\.mjs$/,
  tasteInspect: /[\\/]taste-skill[\\/]scripts[\\/]inspect\.mjs$/,
  uupmSearch: /[\\/]ui-ux-pro-max[\\/]scripts[\\/]search\.py$/,
  baoyuDesignSystem: /[\\/]claude-design-system[\\/]scripts[\\/]artifact\.mjs$/,
  baoyuCanvas: /[\\/]claude-design[\\/]scripts[\\/]artifact\.mjs$/,
};
const found = Object.fromEntries(Object.keys(wanted).map((k) => [k, null]));

for (const r of searchRoots) walk(r, 0);
process.stdout.write(JSON.stringify({ searched: searchRoots, ...found }, null, 2) + "\n");

function walk(dir, depth) {
  if (depth > 9 || Object.values(found).every(Boolean)) return;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (e === "node_modules" || e === ".git") continue;
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, depth + 1);
    else for (const [k, re] of Object.entries(wanted)) if (!found[k] && re.test(p)) found[k] = p;
  }
}
