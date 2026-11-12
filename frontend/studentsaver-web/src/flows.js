// Money out (negative amounts) and money in (positive amounts), totalled for the charts.
export function monthsBetween(first, last) {
  const out = [];
  let [y, m] = first.split('-').map(Number);
  const [y2, m2] = last.split('-').map(Number);
  while (y < y2 || (y === y2 && m <= m2)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

const round2 = (n) => Math.round(n * 100) / 100;

export function totals(rows) {
  const spent = rows.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0);
  const received = rows.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  return { spent: round2(spent), received: round2(received), net: round2(received - spent) };
}

// period 'all': one bar per month, from the first to the last month in the data (empty months show as 0).
// period '2026-09': one bar per day of that month.
export function flowSeries(allRows, period) {
  if (!allRows.length) return { keys: [], spent: [], received: [] };
  let keys;
  if (period === 'all') {
    const months = allRows.map((t) => t.date.slice(0, 7)).sort();
    keys = monthsBetween(months[0], months[months.length - 1]);
  } else {
    const [y, m] = period.split('-').map(Number);
    keys = Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => `${period}-${String(i + 1).padStart(2, '0')}`);
  }
  const bucket = (t) => (period === 'all' ? t.date.slice(0, 7) : t.date);
  const sum = (sign) => {
    const by = {};
    allRows.forEach((t) => { if (t.amount * sign > 0) by[bucket(t)] = (by[bucket(t)] || 0) + Math.abs(t.amount); });
    return keys.map((k) => ({ key: k, amount: round2(by[k] || 0) }));
  };
  return { keys, spent: sum(-1), received: sum(1) };
}
