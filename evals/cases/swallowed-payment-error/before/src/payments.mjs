export async function charge(amount) { if (amount > 1000) throw new Error('declined'); return { id: 'ch_1' }; }
