import { orderTotal } from './total.mjs';
export const checkout = (cart) => ({ total: orderTotal(cart.items, cart.discount) });
