import { orders } from './db.mjs';

export const routes = {
  'GET /orders/:id': (req) => {
    if (!req.user) return { status: 401 };
    const order = orders.get(Number(req.params.id));
    if (!order) return { status: 404 };
    return { status: 200, body: order };
  },
};
