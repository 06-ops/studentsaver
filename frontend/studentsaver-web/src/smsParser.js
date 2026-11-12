// Reads a bank or UPI SMS and returns { amount, type, payee, date } with null for anything it could not find.
// Dates like 12/10/26 are read day first (Indian format).
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');
const clean = (s) => s.replace(/\s+/g, ' ').replace(/^[\s.,;:\-]+|[\s.,;:\-]+$/g, '');

function isoDate(d, m, y) {
  const year = y < 100 ? 2000 + y : y;
  const dt = new Date(year, m - 1, d);
  if (dt.getFullYear() !== year || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${year}-${pad(m)}-${pad(d)}`;
}

function findDate(text) {
  let m = text.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/);
  if (m) { const r = isoDate(+m[1], +m[2], +m[3]); if (r) return r; }
  m = text.match(/\b(\d{1,2})[- ]?([A-Za-z]{3})[a-z]*[- ,]*(\d{2,4})\b/);
  if (m && MONTHS[m[2].toLowerCase()]) return isoDate(+m[1], MONTHS[m[2].toLowerCase()], +m[3]);
  return null;
}

function findAmount(text) {
  const m = text.match(/(?:\b(?:rs\.?|inr)|₹)\s*([\d,]+(?:\.\d+)?)/i)
    || text.match(/\b(?:debited|credited|sent|paid|received)\s+(?:by|for|with)?\s*([\d,]+\.\d{1,2})\b/i);
  const n = m ? parseFloat(m[1].replace(/,/g, '')) : 0;
  return n > 0 ? n : null;
}

function findType(text) {
  const d = text.search(/\b(debited|debit|sent|paid|spent|withdrawn|purchase)\b/i);
  const c = text.search(/\b(credited|credit|received|deposited|refund)\b/i);
  if (d === -1 && c === -1) return null;
  if (c === -1) return 'expense';
  if (d === -1) return 'income';
  return d < c ? 'expense' : 'income';
}

const STOP = '(?=\\s+(?:on|ref|upi|via|dated|using|avl|bal|not|if|from)\\b|\\s+\\d|[.;\\n]|$)';
const NAME = "([A-Za-z][A-Za-z0-9 &.'-]{1,40}?)";

function findPayee(text, type) {
  let m;
  if ((m = text.match(/\bVPA\s+([\w.-]+)@[\w.-]+/i))) return clean(m[1]);
  if ((m = text.match(/\btrf to\s+(.+?)\s+Ref/i))) return clean(m[1]);
  if ((m = text.match(/\bUPI\/P2[MP]\/\d+\/([^/\n]+?)(?=\/|\s+(?:SMS|UPI|if|not|call|avl)\b|$)/i))) return clean(m[1]);
  if (type === 'expense' && (m = text.match(/;\s*(.+?)\s+credited/i))) return clean(m[1]);
  const lead = type === 'income' ? 'from' : '(?:to|at)';
  m = text.match(new RegExp(`\\b${lead}\\s+(?!a\\/c\\b|account\\b|VPA\\b|your\\b|you\\b)${NAME}${STOP}`, 'i'));
  return m ? clean(m[1]) : null;
}

export function parseSms(text) {
  const type = findType(text);
  return { amount: findAmount(text), type, payee: findPayee(text, type), date: findDate(text) };
}
