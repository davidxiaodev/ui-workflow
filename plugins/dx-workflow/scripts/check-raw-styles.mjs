#!/usr/bin/env node
// Fails when UI source bypasses the design tokens: Tailwind palette classes (text-emerald-600),
// arbitrary values (p-[13px], bg-[#fff]) and literal colours in style objects.
//
//   node check-raw-styles.mjs <dir|file>... [--tokens <file>]... [--allow <path-substring>]... [--json]
//
// Token files (where raw values belong) are skipped: globals.css, variables.css, tailwind.config.*,
// plus every --tokens path. Exit 0 = clean, 1 = findings, 2 = usage error.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve, basename } from "node:path";

const args = process.argv.slice(2);
const roots = [];
const tokens = [];
const allow = [];
let asJson = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--tokens") tokens.push(resolve(args[++i] ?? ""));
  else if (a === "--allow") allow.push(args[++i] ?? "");
  else if (a === "--json") asJson = true;
  else if (a === "-h" || a === "--help") usage(0);
  else roots.push(a);
}
if (roots.length === 0) usage(2);

const EXTS = new Set([".tsx", ".jsx", ".ts", ".js", ".vue", ".svelte", ".html", ".css", ".scss"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "out", ".turbo", "coverage", ".expo", "ios", "android"]);
const TOKEN_NAMES = [/^globals\.css$/, /^variables\.css$/, /^tailwind\.config\.[cm]?[jt]s$/, /^tokens?\.(css|json|ts)$/];
const PALETTE = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const UTIL = "bg|text|border|ring|fill|stroke|from|to|via|outline|decoration|shadow|divide|placeholder|accent|caret";

const RULES = [
  {
    id: "palette-class",
    re: new RegExp(`(?<![\\w-])(?:[a-z]+:)*(?:${UTIL})-(?:${PALETTE})-\\d{2,3}(?:\\/\\d+)?(?![\\w-])`, "g"),
    fix: "Use a semantic token class (text-primary, bg-muted, border-border) or add a token to the token file.",
  },
  {
    id: "arbitrary-value",
    re: /(?<![\w-])(?:[a-z]+:)*-?[a-z][a-z0-9-]*-\[[^\]\s]+\]/g,
    fix: "Use the spacing/size/colour scale. If the scale lacks the value, add a token and document it in docs/design.md.",
  },
  {
    id: "literal-colour",
    re: /\b(?:color|background(?:Color)?|borderColor|fill|stroke|outlineColor)\s*:\s*['"`]\s*(?:#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|oklch\()/g,
    fix: "Reference a CSS variable (var(--primary)) instead of a literal colour.",
  },
  {
    id: "white-black-class",
    re: new RegExp(`(?<![\\w-])(?:[a-z]+:)*(?:${UTIL})-(?:white|black)(?:\\/\\d+)?(?![\\w-])`, "g"),
    fix: "Use background/foreground tokens so dark mode and brand overrides work.",
  },
];

const findings = [];
for (const r of roots) walk(resolve(r));

if (asJson) {
  process.stdout.write(JSON.stringify({ count: findings.length, findings }, null, 2) + "\n");
} else if (findings.length === 0) {
  console.log("check-raw-styles: clean");
} else {
  const byRule = {};
  for (const f of findings) (byRule[f.rule] ??= []).push(f);
  for (const [rule, list] of Object.entries(byRule)) {
    console.log(`\n${rule} (${list.length}) -> ${RULES.find((x) => x.id === rule).fix}`);
    for (const f of list.slice(0, 40)) console.log(`  ${f.file}:${f.line}  ${f.match}`);
    if (list.length > 40) console.log(`  … ${list.length - 40} more`);
  }
  console.log(`\ncheck-raw-styles: ${findings.length} finding(s)`);
}
process.exit(findings.length ? 1 : 0);

function walk(p) {
  let st;
  try {
    st = statSync(p);
  } catch {
    console.error(`check-raw-styles: no such path ${p}`);
    process.exit(2);
  }
  if (st.isDirectory()) {
    if (SKIP_DIRS.has(basename(p))) return;
    for (const e of readdirSync(p)) walk(join(p, e));
    return;
  }
  if (!EXTS.has(extname(p))) return;
  if (isTokenFile(p) || isTest(p)) return;
  const rel = relative(process.cwd(), p);
  if (allow.some((a) => a && rel.includes(a))) return;
  const lines = readFileSync(p, "utf8").split(/\r?\n/);
  lines.forEach((text, i) => {
    if (/check-raw-styles-ignore/.test(text)) return;
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      for (const m of text.matchAll(rule.re)) {
        if (text[m.index + m[0].length] === ":") continue;
        if (rule.id === "arbitrary-value" && isAllowedArbitrary(m[0])) continue;
        findings.push({ rule: rule.id, file: rel, line: i + 1, match: m[0] });
      }
    }
  });
}

function isTokenFile(p) {
  return tokens.includes(p) || TOKEN_NAMES.some((re) => re.test(basename(p)));
}

function isTest(p) {
  return /\.(test|spec|e2e|stories)\.[cm]?[jt]sx?$/.test(p) || /[\\/](e2e|__tests__|tests)[\\/]/.test(p);
}

function isAllowedArbitrary(token) {
  if (/-\[[^\]]*(?:var\(--|--[\w-]+)/.test(token)) return true;
  return /^(?:[a-z-]+:)*(?:grid-cols|grid-rows|grid-areas|content|transition|will-change|animate|data|aria|supports|group|peer|has|in|not|nth)-/.test(token.replace(/^-/, ""));
}

function usage(code) {
  console.error("usage: node check-raw-styles.mjs <dir|file>... [--tokens <file>]... [--allow <path-substring>]... [--json]");
  process.exit(code);
}
