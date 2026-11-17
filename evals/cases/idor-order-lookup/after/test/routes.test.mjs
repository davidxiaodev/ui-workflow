import { routes } from '../src/routes.mjs';
const r = routes['GET /orders/:id']({ user: { id: 'c1' }, params: { id: '1' } });
if (r.status !== 200 || r.body.id !== 1) { console.error('own order'); process.exit(1); }
