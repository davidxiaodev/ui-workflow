import { orderTotal } from '../src/total.mjs';
if (orderTotal([{ price: 5, qty: 2 }], 3) !== 7) process.exit(1);
if (orderTotal([{ price: 1, qty: 1 }], 5) !== 0) process.exit(1);
