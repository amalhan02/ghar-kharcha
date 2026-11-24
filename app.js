'use strict';
/* Ghar Kharcha – household expense tracker (no build step; talks to Supabase directly). */

const $app = document.getElementById('app');
const configured = window.CONFIG && !CONFIG.url.includes('YOUR-PROJECT');
const sb = configured ? window.supabase.createClient(CONFIG.url, CONFIG.key) : null;

const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const fmt = (n) => INR.format(Math.round(n || 0));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const ymOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const today = () => { const d = new Date(); return `${ymOf(d)}-${pad(d.getDate())}`; };
const ACCOUNTS = { household: 'Household account', set_aside: 'Set-aside account', own: 'Own account' };

const S = {
  user: null, profiles: [], settings: null, cats: [], exps: [],
  month: ymOf(new Date()), tab: 'home', editing: null, sheet: null, presetCat: null, filter: { cat: '', who: '' }, error: '', busy: false,
};

// ---------- date helpers ----------
const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'short', year: 'numeric' });
};
const shiftMonth = (ym, by) => {
  const [y, m] = ym.split('-').map(Number);
  return ymOf(new Date(y, m - 1 + by, 1));
};
const monthsInclusive = (fromYm, toYm) => {
  const [y1, m1] = fromYm.split('-').map(Number);
  const [y2, m2] = toYm.split('-').map(Number);
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1) + 1);
};
const daysInMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };

// ---------- data ----------
async function fetchAll(build) {
  const size = 1000; let from = 0; let out = [];
  for (;;) {
    const { data, error } = await build().range(from, from + size - 1);
    if (error) throw error;
    out = out.concat(data);
    if (data.length < size) return out;
    from += size;
  }
}

async function loadAll() {
  const [profiles, settings, cats, exps] = await Promise.all([
    fetchAll(() => sb.from('profiles').select('*').order('created_at')),
    sb.from('settings').select('*').eq('id', 1).maybeSingle(),
    fetchAll(() => sb.from('categories').select('*').order('sort').order('id')),
    fetchAll(() => sb.from('expenses').select('*').order('spent_on', { ascending: false }).order('id', { ascending: false })),
  ]);
  if (settings.error) throw settings.error;
  S.profiles = profiles;
  S.settings = settings.data || { monthly_income: 0, spend_cap_pct: 30, start_month: `${S.month}-01` };
  S.cats = cats;
  S.exps = exps.map((e) => ({ ...e, amount: Number(e.amount) }));
}

const catById = (id) => S.cats.find((c) => c.id === id);
const nameOf = (uid) => (S.profiles.find((p) => p.id === uid) || {}).display_name || 'Someone';
const startYm = () => String(S.settings.start_month).slice(0, 7);
const spentIn = (catId, ym) => S.exps.reduce(
  (t, e) => (e.category_id === catId && e.spent_on.slice(0, 7) === ym ? t + e.amount : t), 0);
const spentThrough = (catId, ym) => S.exps.reduce(
  (t, e) => (e.category_id === catId && e.spent_on.slice(0, 7) <= ym ? t + e.amount : t), 0);

// ---------- rendering ----------
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

function render() {
  if (!configured) {
    $app.innerHTML = `<div class="wrap"><div class="card"><h1>Setup needed</h1>
      <p>Open <code>config.js</code> and paste your Supabase project URL and anon key. See README.md.</p></div></div>`;
    return;
  }
  if (!S.user) { $app.innerHTML = viewLogin(); return; }
  const tabs = { home: viewHome, add: viewAdd, history: viewHistory, settings: viewSettings };
  $app.innerHTML = `
    <header><div class="wrap">
      <h1>Ghar Kharcha</h1>
      <div class="month">
        <button data-action="month" data-by="-1" aria-label="Previous month">‹</button>
        <span>${esc(monthLabel(S.month))}</span>
        <button data-action="month" data-by="1" aria-label="Next month">›</button>
      </div>
    </div></header>
    <main class="wrap">${tabs[S.tab]()}</main>
    <nav><div class="wrap">
      ${[['home', '◔', 'Overview'], ['history', '≡', 'History'], ['settings', '⚙', 'Settings']]
        .map(([k, icon, label]) => `<button data-action="tab" data-tab="${k}" class="${S.tab === k ? 'on' : ''}"><span>${icon}</span>${label}</button>`).join('')}
    </div></nav>
    ${S.tab === 'add' || S.sheet ? '' : '<button class="fab" data-action="tab" data-tab="add" aria-label="Add expense">＋</button>'}
    ${S.sheet ? viewSheet() : ''}`;
  const af = $app.querySelector('[data-autofocus]');
  if (af) af.focus();
}

function viewLogin() {
  return `<div class="wrap"><div class="card" style="margin-top:40px">
    <h1 style="margin:0 0 4px">Ghar Kharcha</h1>
    <div class="muted">Your household's daily expenses against the budget.</div>
    <form id="login">
      <label>Email</label><input name="email" type="email" autocomplete="email" required>
      <label>Password</label><input name="password" type="password" autocomplete="current-password" minlength="8" required>
      <label>Your name (only when creating an account)</label><input name="display_name" autocomplete="given-name">
      <button class="primary" name="mode" value="in">Sign in</button>
      <button class="ghost" style="width:100%;margin-top:8px" name="mode" value="up">Create account</button>
      ${S.error ? `<div class="err">${esc(S.error)}</div>` : ''}
    </form></div></div>`;
}

function barHtml(spent, budget) {
  const ratio = budget > 0 ? spent / budget : (spent > 0 ? 1.01 : 0);
  const cls = ratio > 1 ? 'bad' : ratio > 0.85 ? 'warn' : '';
  return `<div class="bar ${cls}"><i style="width:${Math.min(100, ratio * 100).toFixed(1)}%"></i></div>`;
}

function viewHome() {
  const ym = S.month;
  const visible = S.cats.filter((c) => c.active || spentIn(c.id, ym) > 0);
  const monthly = visible.filter((c) => c.kind === 'monthly');
  const funds = visible.filter((c) => c.kind === 'fund');
  const income = Number(S.settings.monthly_income);
  const capPct = Number(S.settings.spend_cap_pct);
  const cap = income * capPct / 100;

  const monthlyBudget = monthly.reduce((t, c) => t + Number(c.monthly_budget), 0);
  const monthlySpent = monthly.reduce((t, c) => t + spentIn(c.id, ym), 0);
  const fundAlloc = funds.reduce((t, c) => t + Number(c.monthly_budget), 0);
  const counted = monthlySpent + fundAlloc;            // spent day-to-day + money set aside into funds
  const left = monthlyBudget - monthlySpent;
  const isNow = ym === ymOf(new Date());
  const daysLeft = isNow ? daysInMonth(ym) - new Date().getDate() + 1 : 0;

  const scale = Math.max(cap * 1.34, counted, 1);
  const capCls = counted > cap ? 'bad' : counted > cap * 0.9 ? 'warn' : '';
  const pctOfIncome = income > 0 ? (counted / income * 100).toFixed(1) : '0';

  const pending = S.cats.filter((c) => c.active && c.is_fixed && c.kind === 'monthly'
    && Number(c.monthly_budget) > 0 && spentIn(c.id, ym) === 0);

  const group = (grp, title) => {
    const rows = monthly.filter((c) => c.grp === grp);
    if (!rows.length) return '';
    return `<h2>${title}</h2><div class="card">${rows.map((c) => {
      const spent = spentIn(c.id, ym); const budget = Number(c.monthly_budget); const rem = budget - spent;
      return `<div class="cat tap" data-action="quick" data-id="${c.id}"><div class="catmain"><div class="row"><span>${esc(c.name)}</span>
        <span class="muted">${fmt(spent)} / ${fmt(budget)}</span></div>${barHtml(spent, budget)}
        <div class="muted ${rem < 0 ? 'neg' : ''}">${rem < 0 ? `${fmt(-rem)} over` : `${fmt(rem)} left`}</div></div><span class="plus" aria-hidden="true">＋</span></div>`;
    }).join('')}</div>`;
  };

  const byPerson = {};
  S.exps.forEach((e) => { if (e.spent_on.slice(0, 7) === ym) byPerson[e.paid_by] = (byPerson[e.paid_by] || 0) + e.amount; });

  return `
    <div class="card hero">
      <div class="muted">Left for day-to-day spending in ${esc(monthLabel(ym))}</div>
      <div class="big ${left < 0 ? 'neg' : ''}">${fmt(left)}</div>
      <div class="muted">Spent ${fmt(monthlySpent)} of ${fmt(monthlyBudget)}${
        isNow && left > 0 ? ` · about ${fmt(left / daysLeft)} a day for the ${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : ''}</div>
      ${barHtml(monthlySpent, monthlyBudget)}
    </div>
    <div class="card">
      <div class="row"><span>Against your ${capPct}% cap</span><span class="${counted > cap ? 'neg' : 'pos'}">${pctOfIncome}% of in-hand</span></div>
      <div class="bar ${capCls}"><i style="width:${(counted / scale * 100).toFixed(1)}%"></i><b style="left:${(cap / scale * 100).toFixed(1)}%"></b></div>
      <div class="muted">${fmt(counted)} spent or set aside · cap is ${fmt(cap)} ·
        ${counted > cap ? `<span class="neg">${fmt(counted - cap)} over</span>` : `${fmt(cap - counted)} under`}</div>
    </div>
    ${pending.length ? `<div class="card"><div class="row"><span>${pending.length} fixed bill${pending.length === 1 ? '' : 's'} not logged yet</span>
      <button class="ghost" data-action="logfixed">Log them</button></div>
      <div class="muted">${pending.map((c) => esc(c.name)).join(', ')}</div></div>` : ''}
    <div class="hint">Tap any category to add a spend</div>
    ${funds.length ? `<h2>Funds that build up</h2><div class="card">${funds.map((c) => {
      const budget = Number(c.monthly_budget);
      const balance = monthsInclusive(startYm(), ym) * budget - spentThrough(c.id, ym);
      const used = spentIn(c.id, ym);
      return `<div class="cat tap" data-action="quick" data-id="${c.id}"><div class="catmain"><div class="row"><span>${esc(c.name)}</span>
        <span class="${balance < 0 ? 'neg' : 'pos'}">${fmt(balance)}</span></div>
        <div class="muted">+${fmt(budget)} a month${used ? ` · ${fmt(used)} used this month` : ''}</div></div><span class="plus" aria-hidden="true">＋</span></div>`;
    }).join('')}</div>` : ''}
    ${group('needs', 'Needs')}
    ${group('wants', 'Wants')}
    ${Object.keys(byPerson).length ? `<h2>Who paid this month</h2><div class="card">${Object.entries(byPerson)
      .map(([uid, amt]) => `<div class="row" style="padding:4px 0"><span>${esc(nameOf(uid))}</span><span>${fmt(amt)}</span></div>`).join('')}</div>` : ''}`;
}

function catOptions(selected) {
  const opt = (c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}</option>`;
  const list = S.cats.filter((c) => c.active || c.id === selected);
  return `<optgroup label="Needs">${list.filter((c) => c.grp === 'needs').map(opt).join('')}</optgroup>
          <optgroup label="Wants">${list.filter((c) => c.grp === 'wants').map(opt).join('')}</optgroup>`;
}

const sel = (opts, cur) => opts.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('');

function defaultAccount(cat) {
  if (!cat) return 'household';
  if (cat.kind === 'fund' && !/guilt/i.test(cat.name)) return 'set_aside';
  if (/guilt|family support/i.test(cat.name)) return 'own';
  return 'household';
}

function viewAdd() {
  const e = S.editing;
  const counts = {};
  S.exps.forEach((x) => { counts[x.category_id] = (counts[x.category_id] || 0) + 1; });
  const quick = S.cats.filter((c) => c.active && !c.is_fixed)
    .sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0) || a.sort - b.sort).slice(0, 6);
  const selCat = e ? e.category_id : S.presetCat || (quick[0] || S.cats[0] || {}).id;
  const cat = catById(selCat);
  const acct = e ? e.account : defaultAccount(cat);
  const rem = cat && cat.kind === 'monthly' ? Number(cat.monthly_budget) - spentIn(cat.id, S.month) : null;
  return `
    <h2>${e ? 'Edit expense' : 'Add expense'}</h2>
    <form id="expense" class="card">
      <label>Amount (₹)</label>
      <input class="amount" name="amount" type="number" inputmode="decimal" min="1" step="any" required value="${e ? e.amount : ''}" placeholder="0">
      <label>Category</label>
      <div class="chips">${quick.map((c) => `<button type="button" data-action="pickcat" data-id="${c.id}" class="${c.id === selCat ? 'on' : ''}">${esc(c.name)}</button>`).join('')}</div>
      <select name="category_id" style="margin-top:8px" required>${catOptions(selCat)}</select>
      <div class="muted" id="catleft">${rem === null ? '' : rem < 0 ? `Already ${fmt(-rem)} over budget this month` : `${fmt(rem)} left in this category this month`}</div>
      <div class="grid2">
        <div><label>Date</label><input name="spent_on" type="date" required value="${e ? e.spent_on : today()}"></div>
        <div><label>Paid by</label><select name="paid_by">${S.profiles.map((p) =>
          `<option value="${p.id}" ${(e ? e.paid_by : S.user.id) === p.id ? 'selected' : ''}>${esc(p.display_name)}</option>`).join('')}</select></div>
      </div>
      <label>Paid from</label>
      <select name="account">${Object.entries(ACCOUNTS).map(([k, v]) => `<option value="${k}" ${k === acct ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <label>Note (optional)</label><input name="note" maxlength="200" value="${e ? esc(e.note || '') : ''}">
      <button class="primary">${e ? 'Save changes' : 'Add expense'}</button>
      ${e ? '<button type="button" class="ghost" style="width:100%;margin-top:8px" data-action="canceledit">Cancel</button>' : ''}
    </form>`;
}

function viewSheet() {
  const c = catById(S.sheet);
  if (!c) return '';
  const rem = Number(c.monthly_budget) - spentIn(c.id, S.month);
  const info = c.kind === 'fund'
    ? `Fund balance ${fmt(monthsInclusive(startYm(), S.month) * Number(c.monthly_budget) - spentThrough(c.id, S.month))}`
    : rem < 0 ? `${fmt(-rem)} over budget this month` : `${fmt(rem)} left of ${fmt(c.monthly_budget)} this month`;
  return `<div class="backdrop" data-action="closesheet"></div>
    <form id="quick" class="sheet">
      <div class="grab"></div>
      <div class="row"><strong class="sheet-title">${esc(c.name)}</strong><button type="button" class="link" data-action="closesheet">Close</button></div>
      <div class="muted">${info}</div>
      <input class="amount" name="amount" type="number" inputmode="decimal" min="1" step="any" required placeholder="₹0" aria-label="Amount" data-autofocus>
      <div class="chips">${[100, 200, 500, 1000, 2000].map((n) => `<button type="button" data-action="amt" data-n="${n}">+${n}</button>`).join('')}</div>
      <input name="note" maxlength="200" placeholder="Note (optional)" aria-label="Note" style="margin-top:12px">
      <button class="primary">Add spend</button>
      <button type="button" class="link" style="width:100%;margin-top:6px" data-action="moreopts">More options: date, paid by, account</button>
    </form>`;
}

function filteredMonth() {
  return S.exps.filter((e) => e.spent_on.slice(0, 7) === S.month
    && (!S.filter.cat || e.category_id === Number(S.filter.cat))
    && (!S.filter.who || e.paid_by === S.filter.who));
}

function viewHistory() {
  const rows = filteredMonth();
  const total = rows.reduce((t, e) => t + e.amount, 0);
  return `
    <h2>Expenses in ${esc(monthLabel(S.month))}</h2>
    <div class="grid2">
      <select data-filter="cat"><option value="">All categories</option>${S.cats.map((c) =>
        `<option value="${c.id}" ${String(c.id) === S.filter.cat ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <select data-filter="who"><option value="">Everyone</option>${S.profiles.map((p) =>
        `<option value="${p.id}" ${p.id === S.filter.who ? 'selected' : ''}>${esc(p.display_name)}</option>`).join('')}</select>
    </div>
    <div class="card">
      <div class="row"><strong>${rows.length} expense${rows.length === 1 ? '' : 's'} · ${fmt(total)}</strong>
        <button class="ghost" data-action="csv">Export CSV</button></div>
      ${rows.length ? rows.map((e) => `<div class="exp"><div>
          <div>${esc((catById(e.category_id) || {}).name || 'Unknown')}</div>
          <div class="muted">${esc(e.spent_on)} · ${esc(nameOf(e.paid_by))} · ${esc(ACCOUNTS[e.account] || e.account)}${e.note ? ` · ${esc(e.note)}` : ''}</div>
          <button class="link" data-action="edit" data-id="${e.id}">Edit</button>
          <button class="link del" data-action="delete" data-id="${e.id}">Delete</button>
        </div><strong>${fmt(e.amount)}</strong></div>`).join('') : '<div class="muted" style="padding:10px 0">Nothing logged yet for this month.</div>'}
    </div>`;
}

function viewSettings() {
  const s = S.settings;
  const me = S.profiles.find((p) => p.id === S.user.id) || {};
  return `
    <h2>Budget basics</h2>
    <form id="settings" class="card">
      <label>Combined monthly in-hand (₹)</label><input name="monthly_income" type="number" min="0" step="any" required value="${Number(s.monthly_income)}">
      <div class="grid2">
        <div><label>Spending cap (% of in-hand)</label><input name="spend_cap_pct" type="number" min="0" max="100" step="any" required value="${Number(s.spend_cap_pct)}"></div>
        <div><label>Funds build up from</label><input name="start_month" type="month" required value="${esc(startYm())}"></div>
      </div>
      <button class="primary">Save</button>
    </form>
    <h2>Categories and monthly budgets</h2>
    <div class="card"><div class="muted">Changes save as you leave each box. Untick Active to hide a category without losing its history.</div>
      ${S.cats.map((c) => `<div class="cat">
        <input data-cat="${c.id}" data-field="name" value="${esc(c.name)}" aria-label="Name">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:8px">
          <input data-cat="${c.id}" data-field="monthly_budget" type="number" min="0" step="any" value="${Number(c.monthly_budget)}" aria-label="Monthly budget">
          <select data-cat="${c.id}" data-field="grp" aria-label="Group">${sel([['needs', 'Needs'], ['wants', 'Wants']], c.grp)}</select>
          <select data-cat="${c.id}" data-field="kind" aria-label="Type">${sel([['monthly', 'Monthly'], ['fund', 'Fund']], c.kind)}</select>
        </div>
        <div class="row" style="margin-top:8px;align-items:center">
          <label style="margin:0"><input data-cat="${c.id}" data-field="is_fixed" type="checkbox" style="width:auto" ${c.is_fixed ? 'checked' : ''}> Fixed bill</label>
          <label style="margin:0"><input data-cat="${c.id}" data-field="active" type="checkbox" style="width:auto" ${c.active ? 'checked' : ''}> Active</label>
          <button class="link del" data-action="delcat" data-id="${c.id}">Delete</button>
        </div>
      </div>`).join('')}
    </div>
    <h2>New category</h2>
    <form id="newcat" class="card">
      <label>Name</label><input name="name" required maxlength="60">
      <div class="grid2">
        <div><label>Group</label><select name="grp"><option value="needs">Needs</option><option value="wants">Wants</option></select></div>
        <div><label>Type</label><select name="kind"><option value="monthly">Resets every month</option><option value="fund">Fund that builds up</option></select></div>
      </div>
      <label>Monthly budget (₹)</label><input name="monthly_budget" type="number" min="0" step="any" required value="0">
      <label><input name="is_fixed" type="checkbox" style="width:auto"> Same amount every month (fixed bill)</label>
      <button class="primary">Add category</button>
    </form>
    <h2>You</h2>
    <form id="profile" class="card">
      <label>Your name</label><input name="display_name" required maxlength="40" value="${esc(me.display_name || '')}">
      <button class="primary">Save name</button>
      <button type="button" class="ghost" style="width:100%;margin-top:8px" data-action="signout">Sign out</button>
    </form>`;
}

// ---------- actions ----------
async function run(fn, done) {
  if (S.busy) return;
  S.busy = true;
  try {
    await fn();
    await loadAll();
    if (done) toast(done);
  } catch (err) {
    toast(err.message || 'Something went wrong');
  } finally {
    S.busy = false;
    render();
  }
}

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  if (a === 'tab') { S.tab = el.dataset.tab; S.sheet = null; S.presetCat = null; if (S.tab !== 'add') S.editing = null; render(); }
  else if (a === 'quick') { S.sheet = Number(el.dataset.id); render(); }
  else if (a === 'closesheet') { S.sheet = null; render(); }
  else if (a === 'amt') { const inp = document.querySelector('#quick [name=amount]'); inp.value = (Number(inp.value) || 0) + Number(el.dataset.n); inp.focus(); }
  else if (a === 'moreopts') { S.presetCat = S.sheet; S.sheet = null; S.tab = 'add'; render(); }
  else if (a === 'month') { S.month = shiftMonth(S.month, Number(el.dataset.by)); render(); }
  else if (a === 'pickcat') {
    const form = document.getElementById('expense');
    form.category_id.value = el.dataset.id;
    form.category_id.dispatchEvent(new Event('change', { bubbles: true }));
  }
  else if (a === 'canceledit') { S.editing = null; S.tab = 'history'; render(); }
  else if (a === 'edit') { S.editing = S.exps.find((e) => e.id === Number(el.dataset.id)); S.tab = 'add'; render(); }
  else if (a === 'delete') {
    const e = S.exps.find((x) => x.id === Number(el.dataset.id));
    if (e && confirm(`Delete ${fmt(e.amount)} – ${(catById(e.category_id) || {}).name || ''}?`)) {
      run(async () => { const { error } = await sb.from('expenses').delete().eq('id', e.id); if (error) throw error; }, 'Deleted');
    }
  }
  else if (a === 'logfixed') {
    const pending = S.cats.filter((c) => c.active && c.is_fixed && c.kind === 'monthly'
      && Number(c.monthly_budget) > 0 && spentIn(c.id, S.month) === 0);
    const list = pending.map((c) => `${c.name}: ${fmt(c.monthly_budget)}`).join('\n');
    if (pending.length && confirm(`Log these for ${monthLabel(S.month)}?\n\n${list}`)) {
      const date = S.month === ymOf(new Date()) ? today() : `${S.month}-01`;
      run(async () => {
        const { error } = await sb.from('expenses').insert(pending.map((c) => ({
          spent_on: date, amount: Number(c.monthly_budget), category_id: c.id,
          paid_by: S.user.id, account: defaultAccount(c), note: 'Fixed bill',
        })));
        if (error) throw error;
      }, 'Fixed bills logged');
    }
  }
  else if (a === 'csv') {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Date', 'Category', 'Amount', 'Paid by', 'Paid from', 'Note'].join(',')].concat(
      filteredMonth().map((e) => [e.spent_on, q((catById(e.category_id) || {}).name), e.amount,
        q(nameOf(e.paid_by)), q(ACCOUNTS[e.account] || e.account), q(e.note)].join(',')));
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' }));
    link.download = `expenses-${S.month}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }
  else if (a === 'delcat') {
    const c = catById(Number(el.dataset.id));
    if (c && confirm(`Delete the category "${c.name}"? This cannot be undone.`)) {
      run(async () => {
        const { error } = await sb.from('categories').delete().eq('id', c.id);
        if (error) throw new Error(error.code === '23503' ? 'This category has expenses. Untick Active to hide it instead.' : error.message);
      }, 'Category deleted');
    }
  }
  else if (a === 'signout') { sb.auth.signOut(); }
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.dataset.filter) { S.filter[el.dataset.filter] = el.value; render(); return; }
  if (el.name === 'category_id' && el.form && el.form.id === 'expense') {
    const cat = catById(Number(el.value));
    el.form.account.value = defaultAccount(cat);
    el.form.querySelectorAll('.chips button').forEach((b) => b.classList.toggle('on', b.dataset.id === el.value));
    const rem = cat && cat.kind === 'monthly' ? Number(cat.monthly_budget) - spentIn(cat.id, S.month) : null;
    document.getElementById('catleft').textContent = rem === null ? ''
      : rem < 0 ? `Already ${fmt(-rem)} over budget this month` : `${fmt(rem)} left in this category this month`;
    return;
  }
  if (el.dataset.cat) {
    const field = el.dataset.field;
    const value = (field === 'active' || field === 'is_fixed') ? el.checked : field === 'monthly_budget' ? Number(el.value) : el.value.trim();
    if (field === 'name' && !value) { toast('Name cannot be empty'); render(); return; }
    if (field === 'monthly_budget' && !(value >= 0)) { toast('Budget must be 0 or more'); render(); return; }
    run(async () => {
      const { error } = await sb.from('categories').update({ [field]: value }).eq('id', Number(el.dataset.cat));
      if (error) throw error;
    }, 'Saved');
  }
});

document.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const f = Object.fromEntries(new FormData(form));

  if (form.id === 'login') {
    const mode = ev.submitter ? ev.submitter.value : 'in';
    S.error = '';
    (async () => {
      const res = mode === 'up'
        ? await sb.auth.signUp({ email: f.email, password: f.password, options: { data: { display_name: (f.display_name || '').trim() } } })
        : await sb.auth.signInWithPassword({ email: f.email, password: f.password });
      if (res.error) S.error = res.error.message;
      else if (mode === 'up' && !res.data.session) S.error = 'Account created. Check your email to confirm it, then sign in.';
      if (!S.user) render();
    })();
  }
  else if (form.id === 'expense') {
    const amount = Number(f.amount);
    if (!(amount > 0)) { toast('Enter an amount'); return; }
    const row = { amount, category_id: Number(f.category_id), spent_on: f.spent_on, paid_by: f.paid_by,
      account: f.account, note: (f.note || '').trim() || null };
    const editing = S.editing;
    run(async () => {
      const { error } = editing
        ? await sb.from('expenses').update(row).eq('id', editing.id)
        : await sb.from('expenses').insert(row);
      if (error) throw error;
      S.editing = null;
      S.month = row.spent_on.slice(0, 7);
      if (editing) S.tab = 'history';
    }, editing ? 'Updated' : `Added ${fmt(amount)}`);
  }
  else if (form.id === 'quick') {
    const amount = Number(f.amount);
    const c = catById(S.sheet);
    if (!c) return;
    if (!(amount > 0)) { toast('Enter an amount'); return; }
    run(async () => {
      const { error } = await sb.from('expenses').insert({ amount, category_id: c.id, spent_on: today(), paid_by: S.user.id,
        account: defaultAccount(c), note: (f.note || '').trim() || null });
      if (error) throw error;
      S.sheet = null;
      S.month = ymOf(new Date());
    }, `Added ${fmt(amount)} to ${c.name}`);
  }
  else if (form.id === 'settings') {
    run(async () => {
      const { error } = await sb.from('settings').update({
        monthly_income: Number(f.monthly_income), spend_cap_pct: Number(f.spend_cap_pct), start_month: `${f.start_month}-01`,
      }).eq('id', 1);
      if (error) throw error;
    }, 'Saved');
  }
  else if (form.id === 'newcat') {
    run(async () => {
      const sort = S.cats.reduce((m, c) => Math.max(m, c.sort), 0) + 10;
      const { error } = await sb.from('categories').insert({
        name: f.name.trim(), grp: f.grp, kind: f.kind, monthly_budget: Number(f.monthly_budget),
        is_fixed: f.is_fixed === 'on', sort,
      });
      if (error) throw error;
    }, 'Category added');
  }
  else if (form.id === 'profile') {
    run(async () => {
      const { error } = await sb.from('profiles').update({ display_name: f.display_name.trim() }).eq('id', S.user.id);
      if (error) throw error;
    }, 'Saved');
  }
});

// ---------- start ----------
async function boot(session) {
  S.user = session ? session.user : null;
  if (S.user) {
    try { await loadAll(); } catch (err) { S.error = err.message; toast(err.message || 'Could not load data'); }
  }
  render();
}

if (configured) {
  // Defer so we never call Supabase from inside its own auth callback.
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'TOKEN_REFRESHED') return;
    setTimeout(() => boot(session), 0);
  });
} else {
  render();
}
