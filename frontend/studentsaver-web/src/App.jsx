import { useState, useEffect, useCallback } from 'react';
import { HashRouter, Routes, Route, NavLink, Link, Navigate } from 'react-router-dom';
import axios from 'axios';
import { Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis } from 'recharts';
import { signUp, confirmSignUp, login, restoreSession, signOut } from './auth';
import { apiCall } from './api';
import { parseSms } from './smsParser';
import { subscriptionHistory, monthLabel } from './subHistory';
import { dailyPlan } from './dailyLimit';
import { totals, flowSeries } from './flows';

const CATS = ['Food & Drink', 'Transport', 'Shopping', 'Entertainment', 'Housing', 'Software', 'Education', 'Friends & Family', 'Uncategorized'];
const COLORS = ['#2f6fde', '#f0a22e', '#1e8c78', '#c8415b', '#7a5bd1', '#0e9aa7', '#d9742b', '#4c9a2a', '#8795ad'];
const colorOf = (c) => COLORS[Math.max(CATS.indexOf(c), 0) % COLORS.length];
const fmt = (n) => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 });
const monthStr = (offset) => {
  const t = new Date(new Date().getFullYear(), new Date().getMonth() + offset, 1);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
};
const emailOf = (t) => {
  try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email || ''; } catch { return ''; }
};

const PATHS = {
  dashboard: 'M4 4h7v7H4zM13 4h7v4h-7zM13 11h7v9h-7zM4 14h7v6H4z',
  list: 'M4 6h16M4 12h16M4 18h10',
  upload: 'M12 16V4m0 0L8 8m4-4l4 4M4 20h16',
  repeat: 'M4 12a8 8 0 0 1 14-5.3L20 8M20 4v4h-4M20 12a8 8 0 0 1-14 5.3L4 16M4 20v-4h4',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 7.5h.01',
  target: 'M12 3v9h9a9 9 0 1 1-9-9z',
  out: 'M9 4H5v16h4M16 8l4 4-4 4M20 12H9',
};
const Icon = ({ n }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={PATHS[n]} /></svg>;
const NAV = [['/', 'Dashboard', 'dashboard'], ['/transactions', 'Transactions', 'list'], ['/upload', 'Statements', 'upload'],
  ['/subscriptions', 'Subscriptions', 'repeat'], ['/discounts', 'Discounts', 'tag'], ['/budget', 'Budget', 'target']];

function useFetch(path, token, logout) {
  const [state, set] = useState({ data: null, loading: true, error: '' });
  useEffect(() => {
    let live = true;
    apiCall(path, token)
      .then((r) => live && set({ data: r.data, loading: false, error: '' }))
      .catch((e) => {
        if (e.response?.status === 401) return logout();
        live && set({ data: null, loading: false, error: 'Could not load this page. Check your connection and try again.' });
      });
    return () => { live = false; };
  }, [path, token, logout]);
  return state;
}

const Loading = () => <><div className="skel" /><div className="skel" /></>;

function AuthScreen({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState({ text: '', ok: false });
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg({ text: '', ok: false });
    try {
      if (mode === 'login') return onLogin(await login(email, password));
      if (mode === 'signup') {
        await signUp(email, password);
        setMode('confirm');
        setMsg({ text: 'We emailed you a 6-digit code. Enter it below.', ok: true });
      } else {
        await confirmSignUp(email, code);
        setMode('login');
        setMsg({ text: 'Email confirmed. You can log in now.', ok: true });
      }
    } catch (err) {
      setMsg({ text: err.message, ok: false });
    }
    setBusy(false);
  }

  const title = mode === 'login' ? 'Welcome back' : mode === 'signup' ? 'Create your account' : 'Confirm your email';
  return (
    <div className="auth">
      <aside className="authside">
        <div className="brand"><span className="coin">₹</span>StudentSaver</div>
        <h2>Know where your money goes.</h2>
        <p>Upload a bank statement and see your spending by category.</p>
        <p>Find the subscriptions you forgot you pay for.</p>
        <p>Get student discounts and budget alerts by email.</p>
      </aside>
      <form className="authform" onSubmit={submit}>
        <h1>{title}</h1>
        {mode !== 'confirm' && (
          <div className="tabs">
            <button type="button" className={'chip' + (mode === 'login' ? ' on' : '')} onClick={() => setMode('login')}>Log in</button>
            <button type="button" className={'chip' + (mode === 'signup' ? ' on' : '')} onClick={() => setMode('signup')}>Sign up</button>
          </div>
        )}
        <label htmlFor="email">College email</label>
        <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        {mode !== 'confirm' && (
          <>
            <label htmlFor="pw">Password</label>
            <input id="pw" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          </>
        )}
        {mode === 'confirm' && (
          <>
            <label htmlFor="code">Confirmation code</label>
            <input id="code" required value={code} onChange={(e) => setCode(e.target.value)} />
          </>
        )}
        <p className={msg.ok ? 'ok' : 'err'} role="status">{msg.text}</p>
        <button className="btn gold" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : mode === 'signup' ? 'Create account' : 'Confirm email'}
        </button>
      </form>
    </div>
  );
}

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function BudgetProgress({ token, logout }) {
  const month = monthStr(0);
  const b = useFetch(`/budget?month=${month}`, token, logout);
  const t = useFetch('/transactions', token, logout);
  if (b.loading || t.loading || b.error || t.error) return null;

  const budgets = b.data.categoryBudgets || {};
  const entries = Object.entries(budgets);
  const dailyLimit = Number(b.data.dailyLimit) || 0;
  if (!entries.length && !dailyLimit) {
    return <div className="panel tip">Set a monthly budget or a daily limit on the <Link to="/budget">Budget page</Link> to see how much you can spend today.</div>;
  }
  const today = todayStr();
  const spentBy = {};
  let todayAll = 0;
  let todayBudgeted = 0;
  t.data.forEach((x) => {
    if (x.amount >= 0) return;
    if (x.date.startsWith(month)) spentBy[x.category] = (spentBy[x.category] || 0) - x.amount;
    if (x.date === today) { todayAll -= x.amount; if (x.category in budgets) todayBudgeted -= x.amount; }
  });
  const total = entries.reduce((s, [, v]) => s + v, 0);
  const spent = entries.reduce((s, [c]) => s + (spentBy[c] || 0), 0);
  const outside = Object.entries(spentBy).filter(([c]) => !(c in budgets)).reduce((s, [, v]) => s + v, 0);
  const plan = dailyPlan({ budgets, monthBudgeted: spent, todayBudgeted, todayAll, dailyLimit });
  const pctToday = plan ? (plan.allowance > 0 ? (plan.spent / plan.allowance) * 100 : plan.spent > 0 ? 100 : 0) : 0;
  const barColor = (pct) => (pct >= 100 ? '#c8415b' : pct >= 80 ? '#f0a22e' : '#1e8c78');
  const left = total - spent;

  return (
    <>
      {plan && (
        <div className="panel">
          <h2>Today</h2>
          <div className="limit">
            {plan.left >= 0 ? <><b>{fmt(plan.left)}</b> left today</> : <b className="err">Over today's limit by {fmt(-plan.left)}</b>}
          </div>
          <p className="muted">
            {fmt(plan.spent)} spent of {fmt(plan.allowance)}.{' '}
            {plan.source === 'own' ? 'This is your own daily limit.' : `Worked out from your monthly budget, with ${plan.daysLeft} ${plan.daysLeft === 1 ? 'day' : 'days'} to go.`}
          </p>
          <div className="bar"><i style={{ width: Math.min(pctToday, 100) + '%', background: barColor(pctToday) }} /></div>
        </div>
      )}
      {entries.length > 0 && (
        <div className="panel">
          <h2>This month's budget</h2>
          <p className="muted">
            {left >= 0 ? `${fmt(left)} left of ${fmt(total)}` : `Over budget by ${fmt(-left)}`}. {fmt(spent)} spent
            {outside > 0 ? `, and another ${fmt(outside)} in categories without a budget.` : '.'}
          </p>
          {entries.map(([c, limit]) => {
            const pct = ((spentBy[c] || 0) / limit) * 100;
            return (
              <div className="crow" key={c}>
                <div className="top"><span>{c}</span><span><b>{fmt(spentBy[c] || 0)}</b> <span className="muted">of {fmt(limit)}</span></span></div>
                <div className="bar"><i style={{ width: Math.min(pct, 100) + '%', background: barColor(pct) }} /></div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function InstallTip() {
  const [ev, setEv] = useState(null);
  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setEv(e); };
    const onDone = () => setEv(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onDone);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onDone); };
  }, []);
  const installed = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (installed || (!ev && !ios)) return null;
  return (
    <div className="panel tip">
      <b>Put StudentSaver on your home screen.</b>{' '}
      {ev
        ? <><button className="btn gold" onClick={async () => { ev.prompt(); await ev.userChoice; setEv(null); }}>Install app</button></>
        : 'In Safari, tap the Share button, then Add to Home Screen.'}
    </div>
  );
}

function AddSheet({ token, onClose, onSaved }) {
  const [tab, setTab] = useState('manual');
  const [f, setF] = useState({ type: 'expense', amount: '', payee: '', date: todayStr(), category: 'Auto' });
  const [sms, setSms] = useState('');
  const [msg, setMsg] = useState({ kind: '', text: '' });
  const [busy, setBusy] = useState(false);
  const [fromSms, setFromSms] = useState(false);
  const canPick = typeof navigator !== 'undefined' && 'contacts' in navigator && 'ContactsManager' in window;
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function readSms() {
    const r = parseSms(sms);
    if (!r.amount) { setMsg({ kind: 'err', text: 'Could not find an amount in that message. Use the Type it in tab instead.' }); return; }
    setF((p) => ({ ...p, amount: String(r.amount), type: r.type || p.type, payee: r.payee || '', date: r.date || p.date }));
    setFromSms(true);
    setTab('manual');
    setMsg({ kind: 'ok', text: r.payee ? 'Check the details below, then save.' : 'Amount found. Add who it was for, then save.' });
  }

  async function pickContact() {
    try {
      const [c] = await navigator.contacts.select(['name'], { multiple: false });
      if (c?.name?.[0]) setF((p) => ({ ...p, payee: c.name[0], category: p.category === 'Auto' ? 'Friends & Family' : p.category }));
    } catch { /* the student closed the picker */ }
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    const amount = Number(f.amount);
    try {
      await apiCall('/add-transaction', token, 'POST', {
        date: f.date,
        description: `${f.type === 'expense' ? 'Paid to' : 'Received from'} ${f.payee.trim()}`,
        amount: f.type === 'expense' ? -amount : amount,
        category: f.category,
        source: fromSms ? 'Pasted SMS' : 'Manual entry',
      });
      onSaved(`Saved ${fmt(amount)} ${f.type === 'expense' ? 'to' : 'from'} ${f.payee.trim()}`);
    } catch {
      setMsg({ kind: 'err', text: 'Could not save. Check the details and try again.' });
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Add a transaction" onClick={(e) => e.stopPropagation()}>
        <div className="sheethead"><h2>Add a transaction</h2><button className="btn ghost" onClick={onClose}>Close</button></div>
        <div className="tabs">
          <button className={'chip' + (tab === 'manual' ? ' on' : '')} onClick={() => setTab('manual')}>Type it in</button>
          <button className={'chip' + (tab === 'sms' ? ' on' : '')} onClick={() => setTab('sms')}>Paste an SMS</button>
        </div>
        {tab === 'sms' ? (
          <>
            <label htmlFor="sms">Bank or UPI message</label>
            <textarea id="sms" rows={5} value={sms} onChange={(e) => setSms(e.target.value)} autoFocus
              placeholder="Paste the payment SMS here" />
            <p><button className="btn gold" disabled={!sms.trim()} onClick={readSms}>Read message</button></p>
            <p className={msg.kind} role="status">{msg.text}</p>
          </>
        ) : (
          <form onSubmit={save}>
            <div className="tabs">
              <button type="button" className={'chip' + (f.type === 'expense' ? ' on' : '')} onClick={() => set('type', 'expense')}>I spent</button>
              <button type="button" className={'chip' + (f.type === 'income' ? ' on' : '')} onClick={() => set('type', 'income')}>I received</button>
            </div>
            <label htmlFor="amt">Amount (₹)</label>
            <input id="amt" type="number" step="0.01" min="0.01" required value={f.amount} autoFocus onChange={(e) => set('amount', e.target.value)} />
            <label htmlFor="payee">{f.type === 'expense' ? 'Paid to' : 'Received from'}</label>
            <input id="payee" required maxLength={60} value={f.payee} onChange={(e) => set('payee', e.target.value)} />
            {canPick
              ? <p><button type="button" className="btn ghost" onClick={pickContact}>Pick from contacts</button></p>
              : <p className="muted">Picking from contacts works in Chrome on Android.</p>}
            <label htmlFor="date">Date</label>
            <input id="date" type="date" required max={todayStr()} value={f.date} onChange={(e) => set('date', e.target.value)} />
            <label htmlFor="cat">Category</label>
            <select id="cat" value={f.category} onChange={(e) => set('category', e.target.value)}>
              <option value="Auto">Let the app choose</option>
              {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <p className={msg.kind} role="status">{msg.text}</p>
            <button className="btn gold" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </form>
        )}
      </div>
    </div>
  );
}

function Dashboard({ token, logout }) {
  const sum = useFetch('/summary', token, logout);
  const subs = useFetch('/subscriptions', token, logout);
  if (sum.loading) return <Loading />;
  if (sum.error) return <p className="err">{sum.error}</p>;

  const cats = Object.entries(sum.data.byCategory || {}).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  const months = Object.entries(sum.data.byMonth || {}).sort().map(([month, spent]) => ({ month, spent }));
  const total = cats.reduce((s, c) => s + c.value, 0);
  const monthlySubs = (subs.data || [])
    .filter((s) => s.status !== 'cancelled')
    .reduce((s, x) => s + (x.frequency === 'weekly' ? (x.amount * 52) / 12 : x.amount), 0);

  return (
    <>
      <h1>Dashboard</h1>
      <p className="sub">Where your money has gone, and what you can still spend.</p>
      <InstallTip />
      <BudgetProgress token={token} logout={logout} />
      {!cats.length ? (
        <div className="panel">
          <h2>No spending yet</h2>
          <p>Upload a bank statement CSV and your categories and charts will appear here.</p>
          <Link className="btn gold" to="/upload">Upload a statement</Link>
        </div>
      ) : (
        <>
          <section className="hero">
            <div className="hero-top">
              <div>
                <div className="label">Total spent</div>
                <div className="big">{fmt(total)}</div>
                <div className="label">across {months.length} {months.length === 1 ? 'month' : 'months'} of statements</div>
              </div>
              <div className="figs">
                <div className="fig"><span className="label">Biggest category</span><b>{cats[0].name}</b></div>
                <div className="fig"><span className="label">Subscriptions</span><b>{fmt(monthlySubs)} a month</b></div>
              </div>
            </div>
            <div className="share" role="img" aria-label="Share of spending by category">
              {cats.map((c) => <i key={c.name} style={{ width: (c.value / total) * 100 + '%', background: colorOf(c.name) }} />)}
            </div>
            <div className="legend">
              {cats.map((c) => <span key={c.name}><i className="dot" style={{ background: colorOf(c.name) }} />{c.name}</span>)}
            </div>
          </section>
          {cats[0].value / total > 0.4 && (
            <div className="panel tip">
              {cats[0].name} is {Math.round((cats[0].value / total) * 100)}% of your spending. Check <Link to="/discounts">student discounts</Link> for savings there.
            </div>
          )}
          <div className="grid2">
            <div className="panel">
              <h2>Categories</h2>
              {cats.map((c) => (
                <div className="crow" key={c.name}>
                  <div className="top">
                    <span>{c.name}</span>
                    <span><b>{fmt(c.value)}</b> <span className="muted">{Math.round((c.value / total) * 100)}%</span></span>
                  </div>
                  <div className="bar"><i style={{ width: (c.value / total) * 100 + '%', background: colorOf(c.name) }} /></div>
                </div>
              ))}
            </div>
            <div className="panel">
              <h2>Spending by month</h2>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={months}>
                  <XAxis dataKey="month" tickLine={false} axisLine={false} />
                  <YAxis width={56} tickLine={false} axisLine={false} tickFormatter={(v) => '₹' + v} />
                  <Tooltip formatter={(v) => fmt(v)} cursor={{ fill: '#f2f5f9' }} />
                  <Bar dataKey="spent" fill="#2f6fde" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </>
  );
}

const payeeOf = (d) => d.toLowerCase().trim().replace(/^(paid to|received from)\s+/, '').replace(/\s+/g, ' ');

function FlowChart({ title, total, data, color, unit }) {
  return (
    <div className="panel">
      <h2>{title}</h2>
      <div className="limit"><b style={{ color }}>{fmt(total)}</b></div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data}>
          <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis width={56} tickLine={false} axisLine={false} tickFormatter={(v) => '₹' + v} />
          <Tooltip formatter={(v) => fmt(v)} labelFormatter={(l) => (unit === 'day' ? `Day ${l}` : l)} cursor={{ fill: '#f2f5f9' }} />
          <Bar dataKey="amount" fill={color} radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Transactions({ token, logout }) {
  const { data, loading, error } = useFetch('/transactions', token, logout);
  const [rows, setRows] = useState(null);
  const [note, setNote] = useState({ kind: '', text: '' });
  const [tab, setTab] = useState('all');
  const [period, setPeriod] = useState('all');
  const [q, setQ] = useState('');
  useEffect(() => { if (data) setRows(data); }, [data]);
  if (loading || (data && !rows)) return <Loading />;
  if (error) return <p className="err">{error}</p>;

  async function recategorize(t, category) {
    try {
      const res = await apiCall('/categorize', token, 'POST', { transactionId: t.transactionId, category });
      const key = payeeOf(t.merchant);
      setRows(rows.map((r) => (payeeOf(r.merchant) === key ? { ...r, category } : r)));
      setNote({ kind: 'ok', text: `Saved. ${res.data.updated} transaction(s) for this payee now use ${category}, and future uploads will too.` });
    } catch {
      setNote({ kind: 'err', text: 'Could not save the category. Try again.' });
    }
  }

  const months = [...new Set(rows.map((t) => t.date.slice(0, 7)))].sort().reverse();
  const per = period === 'all' || months.includes(period) ? period : 'all';
  const inPeriod = per === 'all' ? rows : rows.filter((t) => t.date.startsWith(per));
  const tot = totals(inPeriod);
  const series = flowSeries(rows, per);
  const label = (k) => (per === 'all' ? monthLabel(k) : String(Number(k.slice(8))));
  const chart = (list) => list.map((x) => ({ label: label(x.key), amount: x.amount }));
  const counts = { all: inPeriod.length, spent: inPeriod.filter((t) => t.amount < 0).length, received: inPeriod.filter((t) => t.amount > 0).length };
  const needle = q.trim().toLowerCase();
  const visible = inPeriod.filter((t) => (tab === 'all' || (tab === 'spent' ? t.amount < 0 : t.amount > 0))
    && (!needle || `${t.merchant} ${t.category}`.toLowerCase().includes(needle)));
  const shown = visible.slice(0, 300);
  const shownTotals = totals(visible);

  return (
    <>
      <h1>Transactions</h1>
      <p className="sub">Money you spent and money you received, from every statement you uploaded.</p>
      {note.text && <p className={note.kind} role="status">{note.text}</p>}
      {!rows.length ? (
        <div className="panel">
          <h2>No transactions yet</h2>
          <p>Upload a bank statement and your transactions will be listed here.</p>
          <Link className="btn gold" to="/upload">Upload a statement</Link>
        </div>
      ) : (
        <>
          <div className="filters">
            <div>
              <label htmlFor="per">Period</label>
              <select id="per" value={per} onChange={(e) => setPeriod(e.target.value)}>
                <option value="all">All time</option>
                {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="srch">Search</label>
              <input id="srch" placeholder="Name or category" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          <div className="stats">
            <div className="stat"><b style={{ color: '#c8415b' }}>{fmt(tot.spent)}</b><span>Total spent</span></div>
            <div className="stat"><b style={{ color: '#1e8c78' }}>{fmt(tot.received)}</b><span>Total received</span></div>
            <div className="stat"><b>{tot.net >= 0 ? '+' : '\u2212'}{fmt(Math.abs(tot.net))}</b><span>Received minus spent</span></div>
          </div>
          <div className="grid2">
            <FlowChart title="Total spent" total={tot.spent} data={chart(series.spent)} color="#c8415b" unit={per === 'all' ? 'month' : 'day'} />
            <FlowChart title="Total received" total={tot.received} data={chart(series.received)} color="#1e8c78" unit={per === 'all' ? 'month' : 'day'} />
          </div>
          <div className="chips" style={{ marginTop: 18 }}>
            {[['all', 'All'], ['spent', 'Spent'], ['received', 'Received']].map(([k, name]) => (
              <button key={k} className={'chip' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{name} ({counts[k]})</button>
            ))}
          </div>
          <div className="panel">
            {tab !== 'all' && visible.length > 0 && (
              <p className="muted">{tab === 'spent' ? 'Spent' : 'Received'} in this list: <b>{fmt(shownTotals[tab])}</b></p>
            )}
            {!visible.length && <p className="muted">Nothing matches. Try another period or search.</p>}
            {shown.map((t) => (
              <div className="trow" key={t.transactionId}>
                <span><b>{t.merchant}</b><br /><span className="muted">{t.date}</span></span>
                <b className={'amt' + (t.amount < 0 ? '' : ' ok')}>{t.amount < 0 ? '\u2212' : '+'}{fmt(Math.abs(t.amount))}</b>
                <select className="badge" style={{ '--c': colorOf(t.category) }} value={t.category}
                        aria-label={`Category for ${t.merchant}`} onChange={(e) => recategorize(t, e.target.value)}>
                  {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            ))}
            {visible.length > shown.length && <p className="muted">Showing the newest {shown.length} of {visible.length}. Use the period or search to narrow it.</p>}
          </div>
        </>
      )}
    </>
  );
}

function Upload({ token, logout }) {
  const [files, setFiles] = useState([]);
  const [password, setPassword] = useState('');
  const [results, setResults] = useState([]);
  const [txns, setTxns] = useState(null);
  const [tick, setTick] = useState(0);
  const [note, setNote] = useState({ kind: '', text: '' });
  const [month, setMonth] = useState(monthStr(-1));
  const [confirmText, setConfirmText] = useState('');

  useEffect(() => {
    apiCall('/transactions', token)
      .then((r) => setTxns(r.data))
      .catch((e) => { if (e.response?.status === 401) logout(); else setTxns([]); });
  }, [token, tick, logout]);

  async function upload() {
    const list = Array.from(files);
    setResults(list.map((f) => ({ name: f.name, kind: 'muted', text: 'Waiting\u2026' })));
    const mark = (i, kind, text) => setResults((r) => r.map((x, j) => (j === i ? { ...x, kind, text } : x)));
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const isPdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
      const contentType = isPdf ? 'application/pdf' : 'text/csv';
      try {
        mark(i, 'muted', 'Uploading\u2026');
        const { data } = await apiCall(
          `/upload-link?filename=${encodeURIComponent(f.name)}&contentType=${encodeURIComponent(contentType)}`, token);
        await axios.put(data.uploadUrl, f, { headers: { 'Content-Type': contentType } });
        mark(i, 'muted', 'Reading\u2026');
        const r = await apiCall('/process-statement', token, 'POST', { filename: f.name, password: isPdf ? password : '' });
        mark(i, r.data.count ? 'ok' : 'err', r.data.count ? `Added ${r.data.count} transactions` : 'Opened, but no transactions were found. This layout may not be supported yet.');
      } catch (e) {
        const code = e.response?.data?.error;
        mark(i, 'err', code === 'password_required' ? 'Password protected. Type the password above and upload this file again.'
          : code === 'wrong_password' ? 'That password did not open this file.' : 'Could not read this file. Try again.');
      }
    }
    setTick((n) => n + 1);
  }

  async function remove(body, question) {
    if (!window.confirm(question)) return;
    try {
      const res = await apiCall('/delete-data', token, 'POST', body);
      setNote({ kind: 'ok', text: `Deleted ${res.data.deleted} transactions.` });
      setConfirmText('');
      setTick((n) => n + 1);
    } catch {
      setNote({ kind: 'err', text: 'Could not delete. Try again.' });
    }
  }

  const groups = {};
  (txns || []).forEach((t) => {
    const s = t.source || '';
    const g = (groups[s] = groups[s] || { source: s, count: 0, from: t.date, to: t.date, spent: 0 });
    g.count += 1;
    if (t.date < g.from) g.from = t.date;
    if (t.date > g.to) g.to = t.date;
    if (t.amount < 0) g.spent += -t.amount;
  });
  const list = Object.values(groups);
  const inMonth = (txns || []).filter((t) => t.date.startsWith(month)).length;

  return (
    <>
      <h1>Statements</h1>
      <p className="sub">Upload a CSV file or a Google Pay PDF statement, and delete the ones you no longer want.</p>
      <div className="panel">
        <label htmlFor="f">Statement files (.csv or .pdf). You can pick several at once.</label>
        <input id="f" type="file" accept=".csv,.pdf" multiple onChange={(e) => { setFiles(Array.from(e.target.files)); setPassword(''); setResults([]); }} />
        {files.some((f) => /\.pdf$/i.test(f.name)) && (
          <>
            <label htmlFor="pdfpw">PDF password (leave empty if they have none)</label>
            <input id="pdfpw" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
            <p className="muted">One password is tried on every selected PDF. It is only used to open the files and is not saved.</p>
          </>
        )}
        <p className="muted">PDF: the statement you download from Google Pay or PhonePe. CSV: the first row must be <code>date,description,amount</code>, with negative amounts for spending. A file may cover many months.</p>
        <button className="btn gold" disabled={!files.length} onClick={upload}>
          {files.length > 1 ? `Upload ${files.length} statements` : 'Upload statement'}</button>
        {results.map((r) => <p key={r.name} className={r.kind} role="status"><b>{r.name}</b>: {r.text}</p>)}
      </div>

      <div className="panel">
        <h2>Your uploaded statements</h2>
        {note.text && <p className={note.kind} role="status">{note.text}</p>}
        {txns === null && <p className="muted">Loading\u2026</p>}
        {txns && !list.length && <p className="muted">Nothing uploaded yet.</p>}
        {list.map((g) => (
          <div className="srow" key={g.source || 'older'}>
            <span>
              <b>{g.source || 'Earlier uploads (file name not saved)'}</b><br />
              <span className="muted">{g.count} transactions from {g.from} to {g.to}, {fmt(g.spent)} spent</span>
            </span>
            <button className="btn ghost" onClick={() => remove({ mode: 'source', source: g.source },
              `Delete ${g.count} transactions from ${g.source || 'your earlier uploads'}?`)}>Delete</button>
          </div>
        ))}
        <p><button className="btn ghost" onClick={() => setTick((n) => n + 1)}>Refresh</button></p>
      </div>

      <div className="panel">
        <h2>Delete a month</h2>
        <p className="muted">Removes every transaction dated in that month, whichever statement it came from.</p>
        <label htmlFor="dm">Month</label>
        <input id="dm" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <p><button className="btn danger" disabled={!inMonth} onClick={() => remove({ mode: 'range', from: `${month}-01`, to: `${month}-31` },
          `Delete ${inMonth} transactions from ${month}?`)}>
          {inMonth ? `Delete ${inMonth} transactions from ${month}` : 'No transactions in this month'}</button></p>
      </div>

      <div className="panel zone">
        <h2>Delete everything</h2>
        <p className="muted">Removes all your transactions, subscriptions, learned categories and uploaded files. Your account and budgets stay.</p>
        <label htmlFor="da">Type DELETE to confirm</label>
        <input id="da" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
        <p><button className="btn danger" disabled={confirmText !== 'DELETE'}
          onClick={() => remove({ mode: 'all' }, 'This permanently deletes all your data. Continue?')}>Delete all my data</button></p>
      </div>
    </>
  );
}

function Subscriptions({ token, logout }) {
  const { data, loading, error } = useFetch('/subscriptions', token, logout);
  const tx = useFetch('/transactions', token, logout);
  if (loading || tx.loading) return <Loading />;
  if (error || tx.error) return <p className="err">{error || tx.error}</p>;
  const active = data.filter((s) => s.status !== 'cancelled');
  const monthly = active.reduce((s, x) => s + (x.frequency === 'weekly' ? (x.amount * 52) / 12 : x.amount), 0);
  const history = subscriptionHistory(active, tx.data);
  return (
    <>
      <h1>Subscriptions</h1>
      <p className="sub">Repeating charges found across everything you uploaded.</p>
      {!active.length ? (
        <div className="panel"><h2>No subscriptions found</h2><p>Upload statements that cover at least two months, in one file or several, and repeating charges are found automatically.</p></div>
      ) : (
        <>
          <div className="panel tip">You pay about <b>{fmt(monthly)}</b> a month, or <b>{fmt(monthly * 12)}</b> a year. Cancel the ones you no longer use.</div>
          <div className="cards">
            {active.map((s) => (
              <div className="card" key={s.merchant}>
                <div className="head"><span className="logo" style={{ '--c': COLORS[0] }}>{s.merchant[0]}</span><h3>{s.merchant}</h3></div>
                <div className="price">{fmt(s.amount)} <span className="muted" style={{ fontSize: '0.9rem', fontFamily: 'Figtree' }}>{s.frequency}</span></div>
                <div className="desc">Last charged {String(s.lastChargeDate).slice(0, 10)}{s.nextExpectedDate ? `. Next around ${s.nextExpectedDate}` : ''}{s.charges ? `. Seen ${s.charges} times.` : ''}</div>
              </div>
            ))}
          </div>
          {history.length > 0 && (
            <div className="panel" style={{ marginTop: 18 }}>
              <h2>Month by month</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={[...history].reverse().map((h) => ({ month: h.month, spent: h.total }))}>
                  <XAxis dataKey="month" tickLine={false} axisLine={false} />
                  <YAxis width={56} tickLine={false} axisLine={false} tickFormatter={(v) => '₹' + v} />
                  <Tooltip formatter={(v) => fmt(v)} cursor={{ fill: '#f2f5f9' }} />
                  <Bar dataKey="spent" fill="#2f6fde" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              {history.map((h) => (
                <div className="srow" key={h.month}>
                  <span>
                    <b>{monthLabel(h.month)}</b><br />
                    <span className="muted">{h.items.map((i) => `${i.name} ${fmt(i.amount)}`).join(', ') || 'No subscription charges'}</span>
                    {h.missing.length > 0 && <><br /><span className="err">Not charged: {h.missing.join(', ')}</span></>}
                  </span>
                  <b>{fmt(h.total)}</b>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function Discounts({ token, logout }) {
  const { data, loading, error } = useFetch('/discounts', token, logout);
  const [cat, setCat] = useState('All');
  const [q, setQ] = useState('');
  if (loading) return <Loading />;
  if (error) return <p className="err">{error}</p>;
  const cats = ['All', ...new Set(data.map((d) => d.category))];
  const shown = data.filter((d) => (cat === 'All' || d.category === cat) && d.store.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <h1>Student discounts</h1>
      <p className="sub">Deals you can get with your college email or ID.</p>
      <input placeholder="Search by store" aria-label="Search by store" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips">
        {cats.map((c) => <button key={c} className={'chip' + (c === cat ? ' on' : '')} onClick={() => setCat(c)}>{c}</button>)}
      </div>
      {!shown.length && <p className="muted">No discounts match. Try another category or search.</p>}
      <div className="cards">
        {shown.map((d) => (
          <div className="card" key={d.discountId}>
            <div className="head">
              <span className="logo" style={{ '--c': colorOf(d.category) }}>{d.store[0]}</span>
              <div><h3>{d.store}</h3><span className="badge" style={{ '--c': colorOf(d.category) }}>{d.category}</span></div>
            </div>
            <div className="desc">{d.discountDetails}<br />Verify with: {d.verificationMethod}</div>
            {d.link && d.link.startsWith('http') && <a className="btn ghost" href={d.link} target="_blank" rel="noreferrer">Get offer</a>}
          </div>
        ))}
      </div>
    </>
  );
}

function Budget({ token }) {
  const [month, setMonth] = useState(monthStr(1));
  const [amounts, setAmounts] = useState({});
  const [status, setStatus] = useState({ kind: '', text: '' });
  const [alertStatus, setAlertStatus] = useState({ kind: '', text: '' });
  const [daily, setDaily] = useState('');
  const [dailyStatus, setDailyStatus] = useState({ kind: '', text: '' });

  useEffect(() => {
    apiCall(`/budget?month=${month}`, token)
      .then((r) => {
        setAmounts(Object.fromEntries(Object.entries(r.data.categoryBudgets || {}).map(([k, v]) => [k, String(v)])));
        setDaily(r.data.dailyLimit ? String(r.data.dailyLimit) : '');
      })
      .catch(() => {});
  }, [month, token]);

  async function enableAlerts() {
    try {
      const res = await apiCall('/alerts', token, 'POST', {});
      if (res.data.status !== 'confirmation_sent') throw new Error('not subscribed');
      setAlertStatus({ kind: 'ok', text: 'Check your email and click the confirmation link from AWS to finish turning on alerts.' });
    } catch {
      setAlertStatus({ kind: 'err', text: 'Could not turn on alerts. Try again.' });
    }
  }

  async function saveDaily() {
    try {
      await apiCall('/budget', token, 'POST', { month: 'settings', categoryBudgets: {}, dailyLimit: daily ? Number(daily) : null });
      setDailyStatus({ kind: 'ok', text: daily ? `Daily limit set to ${fmt(daily)}.` : 'Daily limit removed. Your monthly budget is used instead.' });
    } catch {
      setDailyStatus({ kind: 'err', text: 'Could not save the daily limit. Try again.' });
    }
  }

  async function save() {
    const categoryBudgets = {};
    CATS.forEach((c) => { if (amounts[c]) categoryBudgets[c] = Number(amounts[c]); });
    try {
      await apiCall('/budget', token, 'POST', { month, categoryBudgets });
      setStatus({ kind: 'ok', text: `Budget for ${month} saved.` });
    } catch {
      setStatus({ kind: 'err', text: 'Could not save your budget. Try again.' });
    }
  }

  return (
    <>
      <h1>Plan next month</h1>
      <p className="sub">Set how much you want to spend in each category.</p>
      <div className="panel">
        <label htmlFor="m">Month</label>
        <input id="m" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <div className="budgetgrid">
          {CATS.map((c) => (
            <div key={c}>
              <label htmlFor={c}>{c} (₹)</label>
              <input id={c} type="number" min="0" value={amounts[c] || ''} onChange={(e) => setAmounts({ ...amounts, [c]: e.target.value })} />
            </div>
          ))}
        </div>
        <p><button className="btn gold" onClick={save}>Save budget</button></p>
        <p className={status.kind} role="status">{status.text}</p>
      </div>
      <div className="panel">
        <h2>Daily limit</h2>
        <p className="muted">The most you want to spend in one day. Leave it empty to use your monthly budget divided by the days left.</p>
        <label htmlFor="dl">Daily limit (₹)</label>
        <input id="dl" type="number" min="0" value={daily} onChange={(e) => setDaily(e.target.value)} />
        <p><button className="btn gold" onClick={saveDaily}>Save daily limit</button></p>
        <p className={dailyStatus.kind} role="status">{dailyStatus.text}</p>
      </div>
      <div className="panel">
        <h2>Email alerts and weekly summary</h2>
        <p>Get an email when you reach 80% of a category budget or go over it, plus a summary of your week every Monday.</p>
        <button className="btn" onClick={enableAlerts}>Turn on emails</button>
        <p className={alertStatus.kind} role="status">{alertStatus.text}</p>
      </div>
    </>
  );
}

export default function App() {
  const [token, setToken] = useState(null);
  const [checking, setChecking] = useState(true);
  useEffect(() => { restoreSession().then(setToken).finally(() => setChecking(false)); }, []);
  const onLogin = (t) => setToken(t);
  const logout = useCallback(() => { signOut(); setToken(null); }, []);
  // When a request says the login expired, renew it quietly and only log out if that fails
  const expired = useCallback(async () => { const t = await restoreSession(); if (t) setToken(t); else logout(); }, [logout]);
  const [adding, setAdding] = useState(false);
  const [version, setVersion] = useState(0);
  const [toast, setToast] = useState('');
  const saved = (text) => { setAdding(false); setVersion((v) => v + 1); setToast(text); setTimeout(() => setToast(''), 3500); };

  if (checking) return null;
  if (!token) return <AuthScreen onLogin={onLogin} />;
  const email = emailOf(token);
  return (
    <HashRouter>
      <div className="shell">
        <nav className="side" aria-label="Main">
          <div className="brand"><span className="coin">₹</span>StudentSaver</div>
          {NAV.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === '/'}><Icon n={icon} /><span>{label}</span></NavLink>
          ))}
          <div className="push">
            <div className="me"><span className="avatar">{(email[0] || '?').toUpperCase()}</span><span>{email}</span></div>
            <button className="out" onClick={logout}><Icon n="out" /><span>Log out</span></button>
          </div>
        </nav>
        <main>
          <Routes key={version}>
            <Route path="/" element={<Dashboard token={token} logout={expired} />} />
            <Route path="/transactions" element={<Transactions token={token} logout={expired} />} />
            <Route path="/upload" element={<Upload token={token} logout={expired} />} />
            <Route path="/subscriptions" element={<Subscriptions token={token} logout={expired} />} />
            <Route path="/discounts" element={<Discounts token={token} logout={expired} />} />
            <Route path="/budget" element={<Budget token={token} />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
        <button className="fab" aria-label="Add a transaction" onClick={() => setAdding(true)}>+</button>
        {adding && <AddSheet token={token} onClose={() => setAdding(false)} onSaved={saved} />}
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
    </HashRouter>
  );
}