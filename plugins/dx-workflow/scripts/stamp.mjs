#!/usr/bin/env node
// Commit stamps: every commit says how it was verified, so unverified work can be found later.
//
//   node stamp.mjs                 print the trailer for what would be committed now
//   node stamp.mjs --hook <file>   git prepare-commit-msg mode: add the trailer to the message file
//   node stamp.mjs --install       install the prepare-commit-msg hook in this repository
//
// The trailer is one of:
//   Verified: tree=<12 hex> tier=<1|2|3> lanes=<api:pass,ui:pass>   the evidence pack is of exactly this content
//   Verified: none (<why>)                                            lane files changed, but not verified as committed
// A commit that touches no lane file gets no trailer.
//
// Find unverified commits: git log --format='%h %s%n  %(trailers:key=Verified,valueonly)' origin/main..
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { changedSince, gitLines, gitRoot, indexTreeHash, inLane, loadConfig, readJson } from "./lib/verify-config.mjs";

const args = process.argv.slice(2);
const root = gitRoot(process.cwd());
if (!root) process.exit(0);

if (args.includes("--install")) process.exit(install());

const trailer = stampFor(root);
if (args.includes("--hook")) {
  const file = args[args.indexOf("--hook") + 1];
  const source = args[args.indexOf("--hook") + 2] ?? "";
  if (!trailer || !file || ["merge", "squash"].includes(source)) process.exit(0);
  const msg = readFileSync(file, "utf8");
  if (/^Verified:/m.test(msg)) process.exit(0);
  // Before the comment block git adds, after a blank line, with other trailers.
  const lines = msg.split("\n");
  const firstComment = lines.findIndex((l) => l.startsWith("#"));
  const body = (firstComment === -1 ? lines : lines.slice(0, firstComment)).join("\n").replace(/\s+$/, "");
  const rest = firstComment === -1 ? "" : `\n${lines.slice(firstComment).join("\n")}`;
  const lastPara = body.split(/\n\s*\n/).at(-1) ?? "";
  const joinsTrailers = /^[A-Za-z-]+:\s/m.test(lastPara) && lastPara.split("\n").every((l) => /^[A-Za-z-]+:\s|^\s/.test(l));
  writeFileSync(file, `${body}${joinsTrailers ? "\n" : "\n\n"}${trailer}\n${rest}`);
  process.exit(0);
}
if (trailer) console.log(trailer);

/** The trailer for the staged content, or null when no lane file is in the change. */
function stampFor(root) {
  const cfg = loadConfig(root);
  if (!cfg) return null;
  const changes = changedSince(root, cfg.base);
  const lanes = cfg.lanes.filter((l) => changes.some((c) => inLane(l, c.path)));
  if (lanes.length === 0) return null;
  const staged = indexTreeHash(root);
  const last = readJson(join(cfg.dir, "last-run.json"));
  const evidencePath = last?.runDir ? join(last.runDir, "evidence.md") : null;
  if (!evidencePath || !existsSync(evidencePath)) return "Verified: none (no evidence pack)";
  const evidence = readFileSync(evidencePath, "utf8");
  const tree = /^Tree:\s*([0-9a-f]{40})/m.exec(evidence)?.[1];
  const tier = /\*\*Merge tier: ([^.*]+)\.\*\*/.exec(evidence)?.[1] ?? "unknown";
  if (!tree || tree !== staged) return "Verified: none (the commit differs from the verified content)";
  if (tier === "not ready") return "Verified: none (evidence says not ready)";
  const laneList = lanes.map((l) => `${l.name}:${last.lanes?.[l.name]?.result ?? "not run"}`).join(",");
  return `Verified: tree=${tree.slice(0, 12)} tier=${tier} lanes=${laneList}`;
}

function install() {
  const hooksDir = gitLines(root, ["rev-parse", "--git-path", "hooks"])[0];
  const dir = isAbsolute(hooksDir) ? hooksDir : join(root, hooksDir);
  const hook = join(dir, "prepare-commit-msg");
  const marker = "# dx-workflow stamp";
  if (existsSync(hook)) {
    const text = readFileSync(hook, "utf8");
    if (text.includes(marker)) {
      console.log(`stamp: already installed in ${hook}`);
      return 0;
    }
    console.error(`stamp: ${hook} exists and is not ours. Add this line to it yourself:\n  ${line()}`);
    return 1;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(hook, `#!/bin/sh\n${marker}: adds a Verified: trailer (never blocks a commit)\n${line()}\nexit 0\n`);
  chmodSync(hook, 0o755);
  console.log(`stamp: installed ${hook}`);
  return 0;
}

// The plugin's folder changes when it updates; turn-start.mjs keeps .verify/plugin-root current.
function line() {
  return `P="$(cat "$(git rev-parse --show-toplevel)/.verify/plugin-root" 2>/dev/null)"; [ -n "$P" ] && [ -f "$P/scripts/stamp.mjs" ] && node "$P/scripts/stamp.mjs" --hook "$1" "$2" || true`;
}
