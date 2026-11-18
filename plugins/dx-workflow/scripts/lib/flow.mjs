// Specs and task lists: the artifacts of the define and plan stages, and the gates between stages.
//
// docs/specs/<slug>.md        the spec: goals S1…, non-goals, decisions D1…, open questions Q1…, and
//                             the feature's acceptance criteria A1…, each citing the goals it proves
// docs/specs/<slug>.tasks.md  the task list: T1…, each with lanes, the acceptance ids it delivers,
//                             what it depends on, a size and a risk guess
//
// A task's .verify/acceptance.md is generated from both (taskAcceptance), so a review's marks trace
// back to the spec's goals.

const section = (text, name) => {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${name}\\b`, "i").test(l));
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  return lines.slice(start + 1, end === -1 ? undefined : end);
};
const items = (lines, prefix) =>
  (lines ?? [])
    .map((l) => new RegExp(`^\\s*-\\s*(${prefix}\\d+)\\b\\s*(.*)$`).exec(l))
    .filter(Boolean)
    .map(([, id, rest]) => ({ id, text: rest.trim() }));
const field = (text, name) => new RegExp(`^${name}:\\s*(.+)$`, "im").exec(text)?.[1].trim() ?? null;

export function parseSpec(text) {
  const goals = items(section(text, "Goals"), "S");
  const nonGoals = (section(text, "Non-goals") ?? []).filter((l) => /^\s*-\s*\S/.test(l) && !/^\s*-\s*</.test(l));
  const decisions = items(section(text, "Decisions"), "D");
  const questions = items(section(text, "Open questions"), "Q").map((q) => ({
    ...q,
    resolved: /→\s*D\d+|·\s*resolved\b|·\s*deferred:\s*\S/i.test(q.text),
  }));
  const criteria = items(section(text, "Acceptance"), "A").map((c) => ({
    ...c,
    refs: [...new Set([...c.text.matchAll(/\bS\d+\b/g)].map((m) => m[0]))],
    proof: /·\s*proof:\s*\S/i.test(c.text),
  }));
  return { title: /^#\s*Spec:\s*(.+)$/m.exec(text)?.[1].trim() ?? null, status: field(text, "Status"), goals, nonGoals, decisions, questions, criteria };
}

/** Problems that keep a spec from gating into acceptance and tasks. */
export function checkSpec(spec) {
  const p = [];
  if (!/^agreed$/i.test(spec.status ?? "")) p.push(`Status is "${spec.status ?? "missing"}": the user agrees the spec before building ("Status: agreed").`);
  if (!spec.goals.length) p.push("no goals (## Goals with - S1 …): what outcome makes this worth doing?");
  if (!spec.nonGoals.length) p.push("no non-goals (## Non-goals): say what this does not do, so nobody builds it.");
  for (const q of spec.questions.filter((q) => !q.resolved)) p.push(`${q.id} is open: answer it (→ D<n>), or write "· deferred: <why it is safe to build without it>".`);
  if (!spec.criteria.length) p.push("no acceptance criteria (## Acceptance with - A1 … (S1) · proof: …).");
  const goalIds = new Set(spec.goals.map((g) => g.id));
  for (const g of spec.goals) if (!spec.criteria.some((c) => c.refs.includes(g.id))) p.push(`${g.id} has no acceptance criterion: nothing would show it was reached.`);
  for (const c of spec.criteria) {
    for (const r of c.refs.filter((r) => !goalIds.has(r))) p.push(`${c.id} cites ${r}, which is not a goal.`);
    if (!c.proof) p.push(`${c.id} names no proof ("· proof: <test, journey, screenshot, query>").`);
  }
  for (const [kind, list] of [["goal", spec.goals], ["criterion", spec.criteria], ["decision", spec.decisions], ["question", spec.questions]]) {
    const seen = new Set();
    for (const x of list) {
      if (seen.has(x.id)) p.push(`${kind} id ${x.id} is used twice.`);
      seen.add(x.id);
    }
  }
  return p;
}

export function parseTasks(text) {
  const tasks = [];
  let t = null;
  for (const line of text.split("\n")) {
    const head = /^##\s+(T\d+)\b\s*(.*)$/.exec(line);
    if (head) {
      t = { id: head[1], title: head[2].trim(), lanes: [], acceptance: [], depends: [], size: null, risk: null };
      tasks.push(t);
      continue;
    }
    if (/^#{1,2}\s/.test(line)) t = null;
    const f = t && /^\s*-\s*(lanes|acceptance|depends|size|risk):\s*(.*)$/i.exec(line);
    if (!f) continue;
    const [, key, value] = f;
    const k = key.toLowerCase();
    if (k === "lanes") t.lanes = value.split(/[\s,]+/).filter(Boolean);
    else if (k === "acceptance") t.acceptance = [...value.matchAll(/\bA\d+\b/g)].map((m) => m[0]);
    else if (k === "depends") t.depends = [...value.matchAll(/\bT\d+\b/g)].map((m) => m[0]);
    else t[k] = value.trim();
  }
  return tasks;
}

/** Problems with a task list against its spec (and the project's lane names, when known). */
export function checkTasks(tasks, spec, laneNames = null) {
  const p = [];
  if (!tasks.length) p.push("no tasks (## T1 <title> with - lanes:, - acceptance:, - depends:, - size:, - risk:).");
  const ids = new Set(tasks.map((t) => t.id));
  const criteria = new Set(spec.criteria.map((c) => c.id));
  for (const t of tasks) {
    if (!t.lanes.length) p.push(`${t.id} names no lanes.`);
    for (const l of laneNames ? t.lanes.filter((l) => !laneNames.includes(l)) : []) p.push(`${t.id}: lane "${l}" is not in .verify/config.json.`);
    if (!t.acceptance.length) p.push(`${t.id} delivers no acceptance criterion: what will its review mark?`);
    for (const a of t.acceptance.filter((a) => !criteria.has(a))) p.push(`${t.id} cites ${a}, which is not in the spec's acceptance.`);
    for (const d of t.depends.filter((d) => !ids.has(d))) p.push(`${t.id} depends on ${d}, which is not a task.`);
    if (!/^(S|M)\b/i.test(t.size ?? "")) p.push(`${t.id} size is "${t.size ?? "missing"}": split it until each task is S or M (one pull request, about 400 changed lines at most).`);
    if (!/^[123]\b/.test(t.risk ?? "")) p.push(`${t.id} risk is "${t.risk ?? "missing"}": guess the merge tier (1, 2 or 3) and say why.`);
  }
  for (const c of spec.criteria) if (!tasks.some((t) => t.acceptance.includes(c.id))) p.push(`${c.id} is in no task: nothing would deliver it.`);
  const cycle = findCycle(tasks);
  if (cycle) p.push(`tasks depend on each other in a circle: ${cycle.join(" → ")}.`);
  return p;
}

/** Tasks that can start now: every dependency is in `done`. */
export function readyTasks(tasks, done = []) {
  return tasks.filter((t) => !done.includes(t.id) && t.depends.every((d) => done.includes(d)));
}

/** The .verify/acceptance.md for one task (or the whole spec when task is null). */
export function taskAcceptance(spec, task, { specPath, tasksPath }) {
  const wanted = task ? spec.criteria.filter((c) => task.acceptance.includes(c.id)) : spec.criteria;
  const goals = new Map(spec.goals.map((g) => [g.id, g.text]));
  return [
    `# Acceptance: ${task ? `${task.id} ${task.title}` : spec.title}`,
    `Request: ${spec.title}`,
    `Spec: ${specPath}`,
    ...(task ? [`Task: ${task.id} (${tasksPath})`] : []),
    `Lanes: ${task ? task.lanes.join(", ") : "<lanes>"}`,
    "",
    "## Goals this serves",
    ...[...new Set(wanted.flatMap((c) => c.refs))].map((r) => `- ${r} ${goals.get(r) ?? ""}`.trimEnd()),
    "",
    "## Criteria",
    ...wanted.map((c) => `- ${c.id} ${c.text}`),
    "",
    "## Considered, not applicable",
    "- <go through the adverse cases in shared/acceptance.md for this task's lanes>",
    "",
  ].join("\n");
}

function findCycle(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const state = new Map();
  const stack = [];
  const visit = (id) => {
    if (state.get(id) === 2) return null;
    if (state.get(id) === 1) return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 1);
    stack.push(id);
    for (const d of byId.get(id)?.depends ?? []) {
      const c = byId.has(d) && visit(d);
      if (c) return c;
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const t of tasks) {
    const c = visit(t.id);
    if (c) return c;
  }
  return null;
}
