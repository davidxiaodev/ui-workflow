import assert from "node:assert/strict";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { loadCase, prepare, score } from "../evals/run.mjs";

const CASES = join(dirname(fileURLToPath(import.meta.url)), "../evals/cases");
const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("reviewer evals", () => {
  it("every case prepares with passing checks and a brief", () => {
    for (const name of readdirSync(CASES)) {
      const p = prepare(name);
      dirs.push(dirname(p.root));
      assert.equal(p.checks, "pass", `${name}: ${p.checks}`);
      assert.match(readFileSync(p.brief, "utf8"), /Tree under review/, name);
    }
  });

  it("scores a found bug, a vague miss, and a false Blocker on a clean case", () => {
    const bug = prepare("idor-order-lookup");
    dirs.push(dirname(bug.root));
    const c = loadCase("idor-order-lookup");
    const review = (line) => writeFileSync(join(bug.root, ".verify/review-backend.md"), `# Review\nTree: abcdef1234567\n\n## Findings\n${line}\n\nVerdict: changes required\n`);
    review("- [ ] Blocker · src/routes.mjs:6 · Auth: orders.get is not scoped to req.user, so another customer's order is returned → GET /orders/2 as c1 → filter by customerId");
    assert.deepEqual({ found: score(bug.root, c).found, severity: score(bug.root, c).severity }, { found: true, severity: "Blocker" });
    review("- [ ] Should-fix · src/routes.mjs:1 · security could be better");
    assert.equal(score(bug.root, c).found, false);

    const clean = prepare("clean-rename-with-tests");
    dirs.push(dirname(clean.root));
    writeFileSync(join(clean.root, ".verify/review-backend.md"), "# Review\nTree: abcdef1234567\n\n## Findings\n- [ ] Blocker · src/total.mjs:1 · rename breaks callers\n\nVerdict: changes required\n");
    const s = score(clean.root, loadCase("clean-rename-with-tests"));
    assert.equal(s.falsePositives, 1);
    assert.equal(s.approved, false);
  });
});
