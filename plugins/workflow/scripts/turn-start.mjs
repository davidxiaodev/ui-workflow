#!/usr/bin/env node
// Claude Code UserPromptSubmit hook. Records the working tree's hash when a turn starts
// (.verify/turn.json), so the Stop gate checks a turn only when it changed the content, committed or
// not, and leaves turns that only talked alone. Does nothing in a project without .verify/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitRoot, treeHash, VERIFY_DIR } from "./lib/verify-config.mjs";

let input = {};
try {
  const raw = readFileSync(0, "utf8");
  input = raw.trim() ? JSON.parse(raw) : {};
} catch {
  input = {};
}
const root = gitRoot(input.cwd ?? process.cwd());
if (!root || !existsSync(join(root, VERIFY_DIR))) process.exit(0);
const tree = treeHash(root);
if (tree) {
  mkdirSync(join(root, VERIFY_DIR), { recursive: true });
  writeFileSync(join(root, VERIFY_DIR, "turn.json"), JSON.stringify({ tree, startedAt: new Date().toISOString(), session: input.session_id ?? null }) + "\n");
}
process.exit(0);
