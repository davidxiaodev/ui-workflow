import { calcTotal } from './total.mjs';
export const checkout = (cart) => ({ total: calcTotal(cart.items, cart.discount) });
