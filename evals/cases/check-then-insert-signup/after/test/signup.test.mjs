import { signup } from '../src/signup.mjs';
const a = await signup('a@x.io');
const b = await signup('a@x.io');
if (a.status !== 201 || b.status !== 409) process.exit(1);
