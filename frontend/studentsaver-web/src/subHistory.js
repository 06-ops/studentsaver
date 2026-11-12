// Month-by-month view of subscriptions. Uses the same payee matching and "usual amount" rule as the server.
const payeeOf = (d) => d.toLowerCase().trim().replace(/^(paid to|received from)\s+/, '').replace(/\s+/g, ' ');

export const monthLabel = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

function nextMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
}

export function subscriptionHistory(subs, txns) {
  const spending = txns.filter((t) => t.amount < 0);
  const rows = subs.map((s) => {
    const own = spending.filter((t) => payeeOf(t.merchant) === payeeOf(s.merchant));
    const amounts = own.map((t) => Math.abs(t.amount)).sort((a, b) => a - b);
    const typical = amounts[Math.floor(amounts.length / 2)];
    const charges = own.filter((t) => Math.abs(Math.abs(t.amount) - typical) <= typical * 0.1 + 1e-9);
    return { name: s.merchant.replace(/^paid to\s+/i, ''), charges: charges.map((t) => ({ month: t.date.slice(0, 7), amount: Math.abs(t.amount) })) };
  }).filter((r) => r.charges.length);
  if (!rows.length) return [];

  const all = rows.flatMap((r) => r.charges.map((c) => c.month)).sort();
  const months = [];
  for (let m = all[0]; m <= all[all.length - 1]; m = nextMonth(m)) months.push(m);

  return months.map((month) => {
    const items = [];
    const missing = [];
    rows.forEach((r) => {
      const here = r.charges.filter((c) => c.month === month);
      const months = r.charges.map((c) => c.month).sort();
      if (here.length) items.push({ name: r.name, amount: here.reduce((s, c) => s + c.amount, 0) });
      else if (month > months[0] && month < months[months.length - 1]) missing.push(r.name);
    });
    return { month, items, missing, total: items.reduce((s, i) => s + i.amount, 0) };
  }).reverse();
}
