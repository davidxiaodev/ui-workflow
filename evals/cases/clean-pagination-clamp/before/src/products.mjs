const all = Array.from({ length: 250 }, (_, i) => ({ id: i + 1 }));
export function listProducts(query) {
  return { status: 200, body: all.slice(0, Number(query.limit ?? all.length)) };
}
