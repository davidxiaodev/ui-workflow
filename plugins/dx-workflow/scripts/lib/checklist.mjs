// The project's reliability checklist: docs/checklist.md. Each item says when it applies (read from
// the diff alone), what to check, and the incident or pull request it came from. Only the items whose
// trigger matches the change go to the reviewer, so the list can grow without every review reading
// all of it.
//
//   ## C3 Old saved sessions still load
//   - when: path `src/session/**` or diff `/schemaVersion|MessageType/`
//   - lanes: backend
//   - check: load a transcript written by the previous release; new fields need a default.
//   - source: incident 2026-10-02, PR #412
//
// "when" is one or more terms joined by "or": `path <glob>` matches a changed file, `diff /<regex>/`
// matches an added or removed line. "lanes" is optional (default: every lane).
import { matchAny } from "./verify-config.mjs";

export const CHECKLIST_PATH = "docs/checklist.md";

/** Parses checklist markdown into [{ id, title, paths, patterns, lanes, check, source, errors }]. */
export function parseChecklist(text) {
  const items = [];
  let item = null;
  for (const line of (text ?? "").split("\n")) {
    const head = /^##\s+([A-Z]+\d+)\b\s*(.*)$/.exec(line);
    if (head) {
      item = { id: head[1], title: head[2].trim(), paths: [], patterns: [], lanes: null, check: "", source: "", errors: [] };
      items.push(item);
      continue;
    }
    if (/^#{1,2}\s/.test(line)) {
      item = null;
      continue;
    }
    const field = item && /^\s*-\s*(when|lanes|check|source):\s*(.*)$/i.exec(line);
    if (!field) continue;
    const [, key, value] = field;
    const k = key.toLowerCase();
    if (k === "when") {
      for (const term of value.split(/\s+or\s+/i)) {
        const path = /^\s*path\s+`([^`]+)`\s*$/i.exec(term);
        const diff = /^\s*diff\s+`\/(.+)\/([a-z]*)`\s*$/i.exec(term);
        if (path) item.paths.push(path[1]);
        else if (diff) {
          try {
            item.patterns.push(new RegExp(diff[1], diff[2].replace(/[gy]/g, "")));
          } catch (e) {
            item.errors.push(`bad regex ${diff[1]}: ${e.message}`);
          }
        } else if (term.trim()) item.errors.push(`unreadable trigger "${term.trim()}" (use path \`glob\` or diff \`/regex/\`)`);
      }
    } else if (k === "lanes") item.lanes = value.split(/[\s,]+/).filter(Boolean);
    else item[k] = value.trim();
  }
  for (const i of items) if (!i.paths.length && !i.patterns.length && !i.errors.length) i.errors.push('no "when" trigger');
  return items;
}

/**
 * Items whose trigger matches: a changed path, or a changed line of the diff.
 * @param {ReturnType<typeof parseChecklist>} items
 * @param {{ paths: string[], lines: string[], lane?: string }} change
 */
export function matchChecklist(items, { paths, lines, lane }) {
  return items
    .filter((i) => !lane || !i.lanes || i.lanes.includes(lane))
    .map((i) => {
      const byPath = paths.filter((p) => matchAny(i.paths, p));
      const byLine = i.patterns.flatMap((re) => lines.filter((l) => re.test(l)).slice(0, 1));
      return { ...i, why: [...byPath.slice(0, 3).map((p) => `path ${p}`), ...byLine.map((l) => `line "${l.trim().slice(0, 80)}"`)] };
    })
    .filter((i) => i.why.length);
}
