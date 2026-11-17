const rows = [];
export const users = {
  async findByEmail(email) { await tick(); return rows.find((r) => r.email === email) ?? null; },
  async insert(row) { await tick(); rows.push(row); return row; },
  all: () => rows,
};
const tick = () => new Promise((r) => setTimeout(r, 1));
