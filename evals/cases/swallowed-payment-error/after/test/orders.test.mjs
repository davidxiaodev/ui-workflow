import { placeOrder } from '../src/orders.mjs';
const r = await placeOrder({ total: 20 });
if (r.status !== 201 || r.body.status !== 'paid') process.exit(1);
