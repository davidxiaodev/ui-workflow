import { users } from './db.mjs';

export async function signup(email) {
  const existing = await users.findByEmail(email);
  if (existing) return { status: 409 };
  const user = await users.insert({ email, createdAt: Date.now() });
  return { status: 201, body: user };
}
