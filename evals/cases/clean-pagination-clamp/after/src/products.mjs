const all = Array.from({ length: 250 }, (_, i) => ({ id: i + 1 }));
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function listProducts(query) {
  const raw = query.limit ?? String(DEFAULT_LIMIT);
  if (!/^\d+$/.test(raw) || Number(raw) < 1) return { status: 400, body: { error: 'limit must be a positive integer' } };
  const limit = Math.min(Number(raw), MAX_LIMIT);
  return { status: 200, body: all.slice(0, limit) };
}
