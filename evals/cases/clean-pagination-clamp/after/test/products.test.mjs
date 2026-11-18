import { listProducts } from '../src/products.mjs';
const eq = (a, b, m) => { if (a !== b) { console.error(m, a, b); process.exit(1); } };
eq(listProducts({}).body.length, 20, 'default');
eq(listProducts({ limit: '500' }).body.length, 100, 'clamp');
eq(listProducts({ limit: '5' }).body.length, 5, 'small');
eq(listProducts({ limit: '0' }).status, 400, 'zero');
eq(listProducts({ limit: 'abc' }).status, 400, 'nan');
