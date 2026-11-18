import { listProducts } from '../src/products.mjs';
if (listProducts({}).body.length !== 250) process.exit(1);
