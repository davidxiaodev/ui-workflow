import { calcTotal } from '../src/total.mjs';
if (calcTotal([{ price: 5, qty: 2 }], 3) !== 7) process.exit(1);
