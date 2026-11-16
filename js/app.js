/* Budget IO – UI. All data lives in localStorage; logic lives in core.js */
(function () {
  'use strict';
  const C = window.BudgetCore;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  /* ---------- helpers ---------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n, d = 2) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const money0 = (n) => money(n, 0);
  const pctFmt = (n) => (n * 100).toFixed(n > 0 && n < 0.1 ? 1 : 0) + '%';
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthLabel = (ym, full = true) => { const [y, m] = ym.split('-').map(Number); return `${(full ? FULL_MONTHS : MONTH_NAMES)[m - 1]} ${y}`; };
  const dateLabel = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${MONTH_NAMES[m - 1]} ${d}, ${y}`; };
  const inMonths = (n) => monthLabel(C.addMonths(todayISO().slice(0, 7), n), false);
  const durationLabel = (months) => { const y = Math.floor(months / 12), m = months % 12; return [y && `${y} yr`, m && `${m} mo`].filter(Boolean).join(' ') || '0 mo'; };

  const CAT_COLORS = {
    Housing: '#4e79a7', Utilities: '#76b7b2', Groceries: '#59a14f', Dining: '#f28e2b', Transport: '#edc948',
    Shopping: '#b07aa1', Entertainment: '#ff9da7', Subscriptions: '#9c755f', Health: '#e15759', Travel: '#17becf',
    Education: '#8c6bb1', 'Debt Payments': '#7f7f7f', Savings: '#2ca02c', Transfer: '#bab0ac', Other: '#a0a7ae', Income: '#0e9f6e',
  };
  const catColor = (c) => CAT_COLORS[c] || '#a0a7ae';
  const BUCKET_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4'];
  const DEBT_TYPES = {
    mortgage: { label: 'Mortgage', icon: '🏠', apr: 6.5 },
    student: { label: 'Student loan', icon: '🎓', apr: 5.5 },
    car: { label: 'Car loan', icon: '🚗', apr: 7 },
    card: { label: 'Credit card', icon: '💳', apr: 22 },
    other: { label: 'Other loan', icon: '💰', apr: 8 },
  };

  /* ---------- state ---------- */
  const KEY = 'budgetio.v1';
  const blank = () => ({ transactions: [], buckets: [], debts: [], rules: {}, budgets: {}, settings: { extra: 0, strategy: 'avalanche' } });
  let state;
  try { state = Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { state = blank(); }
  state.settings = Object.assign({ extra: 0, strategy: 'avalanche' }, state.settings);
  let saveWarned = false;
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch { if (!saveWarned) { saveWarned = true; toast('Could not save – browser storage is unavailable. Use “Back up data”.'); } }
  };

  const ui = { tab: 'dashboard', month: null, tx: { q: '', month: 'all', cat: 'all', limit: 100 }, lastPct: {} };
  const months = () => [...new Set(state.transactions.map((t) => C.monthOf(t.date)))].sort().reverse();
  const focusMonth = () => (ui.month && months().includes(ui.month) ? ui.month : months()[0] || todayISO().slice(0, 7));

  /* ---------- toast & modal ---------- */
  let toastTimer;
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3600);
  }
  const modal = $('#modal');
  function openModal(title, body, onSubmit, opts = {}) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = `${body}<div class="modal-actions"><button type="button" class="btn" data-close>Cancel</button>${opts.noSubmit ? '' : `<button class="btn primary" type="submit">${opts.submit || 'Save'}</button>`}</div>`;
    const form = $('#modalForm');
    form.onsubmit = (e) => {
      e.preventDefault();
      const res = onSubmit && onSubmit(new FormData(form), form);
      if (res !== false) modal.close();
    };
    $('[data-close]', form).onclick = () => modal.close();
    modal.showModal();
    const first = $('input:not([type=hidden]):not([type=checkbox]), select', form);
    if (first && !opts.noFocus) first.focus();
    if (opts.onOpen) opts.onOpen(form);
  }
  const fld = (label, name, val = '', attrs = '') => `<label>${label}<input name="${name}" value="${esc(val)}" ${attrs}></label>`;
  const catOptions = (sel) => C.CATEGORIES.map((c) => `<option ${c === sel ? 'selected' : ''}>${c}</option>`).join('');

  /* ---------- charts ---------- */
  function donut(cats, total) {
    const R = 70, CIRC = 2 * Math.PI * R;
    let off = 0;
    const segs = cats.map((c) => {
      const len = (c.total / total) * CIRC;
      const s = `<circle cx="100" cy="100" r="${R}" fill="none" stroke="${catColor(c.name)}" stroke-width="26" stroke-dasharray="${Math.max(0, len - 1.5)} ${CIRC}" stroke-dashoffset="${-off}" transform="rotate(-90 100 100)"><title>${esc(c.name)}: ${money(c.total)}</title></circle>`;
      off += len; return s;
    }).join('');
    return `<svg class="donut" viewBox="0 0 200 200" role="img" aria-label="Spending by category"><circle cx="100" cy="100" r="${R}" fill="none" stroke="var(--line)" stroke-width="26"/>${segs}
      <text x="100" y="96" font-size="12" style="fill:var(--muted)">Spent</text><text x="100" y="118" font-size="20" font-weight="700">${money0(total)}</text></svg>`;
  }

  function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1)))); return Math.ceil(v / p) * p; }
  const compact = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n % 1e3 ? 1 : 0) + 'k' : String(Math.round(n)));

  function barTrend(reports) {
    const W = 640, H = 220, L = 44, B = 26, T = 10;
    const max = niceMax(Math.max(...reports.flatMap((r) => [r.income, r.spending]), 1));
    const gw = (W - L) / reports.length, bw = Math.min(30, gw / 3);
    const y = (v) => T + (H - T - B) * (1 - v / max);
    let out = [0, 0.5, 1].map((f) => `<line class="grid-line" x1="${L}" x2="${W}" y1="${y(max * f)}" y2="${y(max * f)}"/><text x="${L - 6}" y="${y(max * f) + 4}" text-anchor="end">$${compact(max * f)}</text>`).join('');
    reports.forEach((r, i) => {
      const cx = L + gw * i + gw / 2;
      out += `<rect x="${cx - bw - 2}" y="${y(r.income)}" width="${bw}" height="${H - B - y(r.income)}" rx="3" fill="var(--brand)"><title>${monthLabel(r.month)} income ${money(r.income)}</title></rect>`;
      out += `<rect x="${cx + 2}" y="${y(r.spending)}" width="${bw}" height="${H - B - y(r.spending)}" rx="3" fill="#f28e2b"><title>${monthLabel(r.month)} spending ${money(r.spending)}</title></rect>`;
      out += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${monthLabel(r.month, false)}</text>`;
    });
    return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Income and spending by month">${out}</svg>
      <div class="swatch-legend"><span><span class="dot" style="background:var(--brand)"></span>Income</span><span><span class="dot" style="background:#f28e2b"></span>Spending</span></div>`;
  }

  function lineChart(series) {
    const W = 640, H = 230, L = 52, B = 28, T = 10;
    const maxLen = Math.max(...series.map((s) => s.points.length));
    const max = niceMax(Math.max(...series.flatMap((s) => s.points), 1));
    const x = (i) => L + ((W - L - 8) * i) / Math.max(1, maxLen - 1);
    const y = (v) => T + (H - T - B) * (1 - v / max);
    let out = [0, 0.5, 1].map((f) => `<line class="grid-line" x1="${L}" x2="${W}" y1="${y(max * f)}" y2="${y(max * f)}"/><text x="${L - 6}" y="${y(max * f) + 4}" text-anchor="end">$${compact(max * f)}</text>`).join('');
    const step = maxLen > 240 ? 120 : maxLen > 96 ? 60 : maxLen > 36 ? 24 : 12;
    for (let m = 0; m < maxLen; m += step) out += `<text x="${x(m)}" y="${H - 8}" text-anchor="middle">${m === 0 ? 'Now' : inMonths(m)}</text>`;
    for (const s of series) {
      const pts = s.points.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
      out += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" ${s.dash ? 'stroke-dasharray="6 5"' : ''}/>`;
    }
    return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Projected total debt over time">${out}</svg>
      <div class="swatch-legend">${series.map((s) => `<span><span class="dot" style="background:${s.color}"></span>${esc(s.name)}</span>`).join('')}</div>`;
  }

  /* ---------- jar (savings bucket) ---------- */
  const JAR_H = 118, JAR_TOP = 22;
  const jarOffset = (p) => 126 - Math.min(1, Math.max(0, p)) * 132;
  function jarSvg(b, p) {
    const id = 'j' + b.id;
    const coins = [26, 46, 66, 84, 98].map((x, i) => `<text class="coin" x="${x}" y="${96 - (i % 3) * 14}" style="animation-delay:${-i * 1.1}s">$</text>`).join('');
    return `<svg class="jar" viewBox="0 0 120 150" style="--bucket:${b.color}" role="img" aria-label="${esc(b.name)} jar ${Math.round(p * 100)}% full">
      <defs><clipPath id="${id}"><rect x="14" y="${JAR_TOP}" width="92" height="${JAR_H}" rx="18"/></clipPath></defs>
      <rect class="glass" x="14" y="${JAR_TOP}" width="92" height="${JAR_H}" rx="18"/>
      <g clip-path="url(#${id})"><g transform="translate(0 ${JAR_TOP})"><g class="fill-group" data-p="${p}" style="transform:translateY(${jarOffset(ui.lastPct[b.id] ?? 0)}px)">
        <path class="wave back" d="M-60 6 Q-45 -2 -30 6 T0 6 T30 6 T60 6 T90 6 T120 6 T150 6 T180 6 V150 H-60 Z" transform="translate(12 0)"/>
        <path class="wave" d="M-60 4 Q-45 -4 -30 4 T0 4 T30 4 T60 4 T90 4 T120 4 T150 4 T180 4 V150 H-60 Z"/>
        <g>${coins}</g>
      </g></g></g>
      <path class="shine" d="M26 44 V100"/>
      <rect class="rim" x="24" y="8" width="72" height="14" rx="5"/>
      <text class="pct" x="60" y="92">${Math.round(p * 100)}%</text></svg>`;
  }

  function animateJars() {
    $$('.fill-group').forEach((g) => {
      const p = parseFloat(g.dataset.p);
      requestAnimationFrame(() => requestAnimationFrame(() => { g.style.transform = `translateY(${jarOffset(p)}px)`; }));
    });
    state.buckets.forEach((b) => { ui.lastPct[b.id] = bucketPct(b); });
  }
  const bucketPct = (b) => (b.goal > 0 ? Math.min(1, b.saved / b.goal) : 0);

  function dropCash(bucketId, count = 7) {
    const card = $(`[data-bucket="${bucketId}"]`); if (!card) return;
    const jar = $('.jar-wrap', card);
    for (let i = 0; i < count; i++) {
      const s = document.createElement('span');
      s.className = 'cash-drop'; s.textContent = i % 3 === 0 ? '🪙' : '💵';
      s.style.left = `${20 + Math.random() * 60}%`; s.style.top = '-6px';
      s.style.setProperty('--fall', `${jar.offsetHeight * 0.55}px`);
      s.style.setProperty('--r0', `${Math.random() * 60 - 30}deg`); s.style.setProperty('--r1', `${Math.random() * 360 - 180}deg`);
      s.style.animationDelay = `${i * 0.11}s`;
      jar.appendChild(s); setTimeout(() => s.remove(), 1100 + i * 110 + 100);
    }
  }
  function confetti(bucketId) {
    const card = $(`[data-bucket="${bucketId}"]`); if (!card) return;
    for (let i = 0; i < 40; i++) {
      const s = document.createElement('i'); s.className = 'confetti';
      s.style.left = `${Math.random() * 100}%`; s.style.background = BUCKET_COLORS[i % BUCKET_COLORS.length];
      s.style.setProperty('--dx', `${Math.random() * 120 - 60}px`); s.style.animationDelay = `${Math.random() * 0.5}s`;
      card.appendChild(s); setTimeout(() => s.remove(), 3200);
    }
  }
  function milestone(p) {
    return p >= 1 ? '🎉 Goal reached!' : p >= 0.75 ? '🔥 Almost there!' : p >= 0.5 ? '💪 Halfway there!' : p >= 0.25 ? '🌱 Great start!' : p > 0 ? 'Every dollar counts.' : 'Make your first deposit.';
  }

  /* ---------- views ---------- */
  const views = { dashboard: vDashboard, transactions: vTransactions, buckets: vBuckets, reports: vReports, debts: vDebts };

  function render() {
    $$('#tabs button').forEach((b) => (b.getAttribute('data-tab') === ui.tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
    $('#view').innerHTML = views[ui.tab]();
    animateJars();
  }
  function go(tab) { ui.tab = tab; render(); window.scrollTo(0, 0); try { history.replaceState(null, '', '#' + tab); } catch { /* ignore */ } }

  const isEmpty = () => !state.transactions.length && !state.buckets.length && !state.debts.length;

  function emptyHero() {
    return `<div class="card empty"><h3>Welcome to Budget IO 👋</h3><p>Upload a CSV from your bank to see where your money goes, set up savings buckets, and map out debt payoff.</p>
      <button class="btn primary" data-action="import">⬆ Upload a CSV</button>
      <button class="btn" data-action="add-bucket">🪣 New savings bucket</button>
      <button class="btn" data-action="add-debt">📉 Add a debt</button>
      <button class="btn" data-action="sample">✨ Load sample data</button></div>`;
  }

  function debtPlans() {
    const debts = state.debts.filter((d) => d.balance > 0);
    const extra = +state.settings.extra || 0;
    return {
      base: C.payoffPlan(debts, { extra: 0, rollover: false }),
      avalanche: C.payoffPlan(debts, { extra, strategy: 'avalanche' }),
      snowball: C.payoffPlan(debts, { extra, strategy: 'snowball' }),
    };
  }

  function vDashboard() {
    if (isEmpty()) return `<div class="page-head"><h1>Dashboard</h1></div>${emptyHero()}`;
    const ym = focusMonth(), r = C.monthlyReport(state.transactions, ym);
    const totalSaved = state.buckets.reduce((s, b) => s + b.saved, 0);
    const debtTotal = state.debts.reduce((s, d) => s + d.balance, 0);
    const plan = state.debts.length ? debtPlans()[state.settings.strategy] : null;
    const recent = [...state.transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
    return `<div class="page-head"><h1>Dashboard</h1><div class="head-tools">${monthSelect()}</div></div>
      <div class="tiles">
        ${tile('Income', money0(r.income), monthLabel(ym), 'pos')}
        ${tile('Spending', money0(r.spending), `${r.categories.length} categories`)}
        ${tile('Net', money0(r.net), r.savingsRate == null ? '' : `${pctFmt(Math.max(r.savingsRate, 0))} saved`, r.net >= 0 ? 'pos' : 'neg')}
        ${tile('In savings buckets', money0(totalSaved), `${state.buckets.length} bucket${state.buckets.length === 1 ? '' : 's'}`)}
        ${tile('Total debt', money0(debtTotal), plan && plan.months && !plan.neverPaidOff.length ? `Debt-free ${inMonths(plan.months)}` : '')}
      </div>
      <div class="grid cols-2">
        <section class="card"><div class="card-head"><h2>Top spending · ${monthLabel(ym, false)}</h2><button class="btn sm" data-tab-go="reports">Full report</button></div>
          ${r.categories.length ? r.categories.slice(0, 6).map((c) => catRow(c, r.spending)).join('') : '<p class="muted">No spending recorded this month.</p>'}</section>
        <section class="card"><div class="card-head"><h2>Savings buckets</h2><button class="btn sm" data-tab-go="buckets">Open</button></div>
          ${state.buckets.length ? state.buckets.map((b) => `<div class="cat-row"><span>${esc(b.name)}</span><span class="num">${money0(b.saved)} / ${money0(b.goal)}</span><div class="bar"><i style="width:${bucketPct(b) * 100}%;background:${b.color}"></i></div></div>`).join('') : '<p class="muted">No buckets yet. <button class="link" data-action="add-bucket">Create one</button></p>'}</section>
        <section class="card"><div class="card-head"><h2>Debt payoff</h2><button class="btn sm" data-tab-go="debts">Open</button></div>
          ${state.debts.length ? state.debts.map((d) => { const p = d.original > 0 ? Math.max(0, 1 - d.balance / d.original) : 0; return `<div class="cat-row"><span>${DEBT_TYPES[d.type]?.icon || ''} ${esc(d.name)} <span class="muted">· ${d.apr}%</span></span><span class="num">${money0(d.balance)}</span><div class="bar"><i style="width:${p * 100}%"></i></div></div>`; }).join('') : '<p class="muted">No debts tracked. <button class="link" data-action="add-debt">Add one</button></p>'}</section>
        <section class="card"><div class="card-head"><h2>Recent transactions</h2><button class="btn sm" data-tab-go="transactions">All</button></div>
          ${recent.length ? `<table>${recent.map((t) => `<tr><td class="muted">${dateLabel(t.date)}</td><td>${esc(t.desc)}</td><td class="r num ${t.amount >= 0 ? 'pos' : ''}">${money(t.amount)}</td></tr>`).join('')}</table>` : '<p class="muted">Nothing yet.</p>'}</section>
      </div>`;
  }
  const tile = (label, value, sub = '', cls = '') => `<div class="card tile"><div class="label">${label}</div><div class="value num ${cls}">${value}</div><div class="sub">${esc(sub)}&nbsp;</div></div>`;
  const catRow = (c, total, limit) => {
    const over = limit && c.total > limit;
    return `<div class="cat-row"><span><span class="dot" style="background:${catColor(c.name)}"></span>${esc(c.name)}</span><span class="num">${money(c.total)} <span class="muted">${pctFmt(c.total / total)}</span></span>
      <div class="bar ${over ? 'over' : ''}"><i style="width:${Math.min(100, limit ? (c.total / limit) * 100 : (c.total / total) * 100)}%;${limit ? '' : `background:${catColor(c.name)}`}"></i></div></div>`;
  };
  function monthSelect() {
    const ms = months(); if (!ms.length) return '';
    const cur = focusMonth();
    return `<label class="no-print" style="display:flex;gap:8px;align-items:center">Month <select data-change="month" style="width:auto;margin:0">${ms.map((m) => `<option value="${m}" ${m === cur ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}</select></label>`;
  }

  /* transactions */
  function filteredTx() {
    const f = ui.tx, q = f.q.trim().toLowerCase();
    return state.transactions.filter((t) => (f.month === 'all' || C.monthOf(t.date) === f.month) && (f.cat === 'all' || t.category === f.cat) && (!q || t.desc.toLowerCase().includes(q) || String(t.amount).includes(q)))
      .sort((a, b) => b.date.localeCompare(a.date) || a.desc.localeCompare(b.desc));
  }
  function txList() {
    const list = filteredTx(), shown = list.slice(0, ui.tx.limit);
    const net = list.reduce((s, t) => s + t.amount, 0);
    if (!list.length) return `<div class="empty">${state.transactions.length ? 'No transactions match those filters.' : 'No transactions yet. Upload a CSV or add one by hand.'}</div>`;
    return `<p class="muted">${list.length} transaction${list.length === 1 ? '' : 's'} · net <b class="num ${net >= 0 ? 'pos' : 'neg'}">${money(net)}</b></p>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Description</th><th>Category</th><th class="r">Amount</th><th></th></tr></thead><tbody>
      ${shown.map((t) => `<tr><td class="muted" style="white-space:nowrap">${dateLabel(t.date)}</td><td>${esc(t.desc)}</td>
        <td><select data-change="txcat" data-id="${t.id}" aria-label="Category">${catOptions(t.category)}</select></td>
        <td class="r num ${t.amount >= 0 ? 'pos' : ''}">${money(t.amount)}</td>
        <td class="r"><button class="btn sm danger" data-action="del-tx" data-id="${t.id}" aria-label="Delete transaction">✕</button></td></tr>`).join('')}
      </tbody></table></div>${list.length > shown.length ? `<p style="text-align:center"><button class="btn" data-action="more-tx">Show more (${list.length - shown.length} left)</button></p>` : ''}`;
  }
  function vTransactions() {
    const f = ui.tx;
    return `<div class="page-head"><h1>Transactions</h1><div class="head-tools"><button class="btn" data-action="add-tx">＋ Add</button><button class="btn primary" data-action="import">⬆ Upload CSV</button></div></div>
      <div class="card"><div class="field-row">
        <label>Search<input type="search" data-input="txq" value="${esc(f.q)}" placeholder="Description or amount"></label>
        <label>Month<select data-change="txmonth"><option value="all">All time</option>${months().map((m) => `<option value="${m}" ${f.month === m ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}</select></label>
        <label>Category<select data-change="txfcat"><option value="all">All categories</option>${catOptions(f.cat)}</select></label></div>
        <div id="txList">${txList()}</div></div>`;
  }

  /* savings buckets */
  function vBuckets() {
    const total = state.buckets.reduce((s, b) => s + b.saved, 0), goal = state.buckets.reduce((s, b) => s + b.goal, 0);
    return `<div class="page-head"><h1>Savings buckets</h1><div class="head-tools"><button class="btn primary" data-action="add-bucket">＋ New bucket</button></div></div>
      ${state.buckets.length ? `<div class="card hero-total" style="margin-bottom:16px"><div class="tile"><div class="label">Total saved</div><div class="value num">${money0(total)}</div><div class="sub">${goal ? `${pctFmt(total / goal)} of your ${money0(goal)} in goals` : ''}</div></div></div>` : ''}
      ${state.buckets.length ? `<div class="grid cols-2">${state.buckets.map(bucketCard).join('')}</div>` : `<div class="card empty"><h3>Fill your first bucket 🪣</h3><p>Create a goal – an emergency fund, a vacation, a down payment – then deposit into it and watch it fill with cash.</p><button class="btn primary" data-action="add-bucket">Create a bucket</button></div>`}`;
  }
  function bucketCard(b) {
    const p = bucketPct(b), left = Math.max(0, b.goal - b.saved);
    const months = b.monthly > 0 && left > 0 ? Math.ceil(left / b.monthly) : null;
    return `<section class="card bucket ${p >= 1 ? 'done' : ''}" data-bucket="${b.id}">
      <div class="jar-wrap">${jarSvg(b, p)}</div>
      <div><h3>${esc(b.name)}</h3>
        <div class="amounts num">${money(b.saved)} <span class="muted" style="font-size:.9rem;font-weight:400">of ${money0(b.goal)}</span></div>
        <div class="milestone">${milestone(p)}</div>
        <div class="muted" style="font-size:.85rem">${left > 0 ? `${money0(left)} to go` : 'Fully funded'}${months ? ` · at ${money0(b.monthly)}/mo → ${inMonths(months)}` : ''}</div>
        <div class="actions"><button class="btn primary sm" data-action="deposit" data-id="${b.id}">＋ Deposit</button><button class="btn sm" data-action="withdraw" data-id="${b.id}">Withdraw</button><button class="btn sm" data-action="edit-bucket" data-id="${b.id}">Edit</button></div></div></section>`;
  }

  /* reports */
  function vReports() {
    if (!state.transactions.length) return `<div class="page-head"><h1>Monthly report</h1></div><div class="card empty"><h3>No data to report on yet</h3><p>Upload a CSV from your bank to get a month-by-month breakdown.</p><button class="btn primary" data-action="import">⬆ Upload a CSV</button><button class="btn" data-action="sample">✨ Load sample data</button></div>`;
    const ym = focusMonth(), r = C.monthlyReport(state.transactions, ym), prev = C.monthlyReport(state.transactions, C.addMonths(ym, -1));
    const trend = [-5, -4, -3, -2, -1, 0].map((n) => C.monthlyReport(state.transactions, C.addMonths(ym, n)));
    const prevMap = Object.fromEntries(prev.categories.map((c) => [c.name, c.total]));
    const hasPrev = prev.count > 0;
    const delta = (c) => {
      if (!hasPrev) return '';
      const p = prevMap[c.name]; if (!p) return '<span class="legend-delta pill warn">new</span>';
      const d = c.total - p; if (Math.abs(d) < 1) return '';
      return `<span class="legend-delta ${d > 0 ? 'neg' : 'pos'}">${d > 0 ? '▲' : '▼'} ${money0(Math.abs(d))}</span>`;
    };
    const budgetKeys = Object.keys(state.budgets).filter((k) => state.budgets[k] > 0);
    const over = r.categories.filter((c) => state.budgets[c.name] > 0 && c.total > state.budgets[c.name]);
    return `<div class="page-head"><h1>Monthly report</h1><div class="head-tools">${monthSelect()}
        <button class="btn no-print" data-action="budgets">🎯 Budgets</button><button class="btn no-print" data-action="export-report">⬇ CSV</button><button class="btn no-print" data-action="print">🖨 Print</button></div></div>
      <div class="tiles">${tile('Income', money0(r.income), hasPrev ? vs(r.income, prev.income) : '', 'pos')}${tile('Spending', money0(r.spending), hasPrev ? vs(r.spending, prev.spending) : '')}
        ${tile('Net', money0(r.net), '', r.net >= 0 ? 'pos' : 'neg')}${tile('Savings rate', r.savingsRate == null ? '–' : pctFmt(r.savingsRate), `${r.count} transactions`)}</div>
      ${over.length ? `<div class="notice">⚠️ Over budget: ${over.map((c) => `<b>${esc(c.name)}</b> (${money0(c.total - state.budgets[c.name])} over)`).join(', ')}</div>` : ''}
      <div class="grid cols-2">
        <section class="card"><h2 style="margin-bottom:12px">Spending by category · ${monthLabel(ym)}</h2>
          ${r.categories.length ? `<div class="donut-wrap">${donut(r.categories, r.spending)}<div>${r.categories.slice(0, 8).map((c) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:2px 0"><span><span class="dot" style="background:${catColor(c.name)}"></span>${esc(c.name)}</span><span class="num">${pctFmt(c.pct)}</span></div>`).join('')}</div></div>` : '<p class="muted">No spending this month.</p>'}</section>
        <section class="card"><h2 style="margin-bottom:12px">Category detail${budgetKeys.length ? ' vs budget' : ''}</h2>
          ${r.categories.map((c) => { const lim = state.budgets[c.name]; return `<div>${catRow(c, r.spending, lim > 0 ? lim : 0).replace('</span><span class="num">', `${delta(c)}</span><span class="num">`)}${lim > 0 ? `<div class="muted" style="font-size:.78rem;text-align:right">budget ${money0(lim)}</div>` : ''}</div>`; }).join('') || '<p class="muted">–</p>'}</section>
        <section class="card"><h2 style="margin-bottom:12px">Last 6 months</h2>${barTrend(trend)}</section>
        <section class="card"><h2 style="margin-bottom:12px">Biggest expenses</h2>
          ${r.biggest.length ? `<table>${r.biggest.map((t) => `<tr><td class="muted">${dateLabel(t.date)}</td><td>${esc(t.desc)}</td><td class="muted">${esc(t.category)}</td><td class="r num">${money(-t.amount)}</td></tr>`).join('')}</table>` : '<p class="muted">–</p>'}</section>
      </div>`;
  }
  const vs = (cur, prev) => { if (!prev) return ''; const d = (cur - prev) / prev; return `${d >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(d * 100))}% vs last month`; };

  /* debts */
  function vDebts() {
    const strat = state.settings.strategy, extra = +state.settings.extra || 0;
    const debts = state.debts;
    const head = `<div class="page-head"><h1>Debt payoff</h1><div class="head-tools"><button class="btn primary" data-action="add-debt">＋ Add debt</button></div></div>`;
    if (!debts.length) return `${head}<div class="card empty"><h3>Track your debts 📉</h3><p>Add your mortgage, student loans, car payments or credit cards with their interest rates to see your payoff date and how extra payments help.</p><button class="btn primary" data-action="add-debt">Add a debt</button><button class="btn" data-action="sample">✨ Load sample data</button></div>`;
    const plans = debtPlans(), plan = plans[strat], baseline = plans.base;
    const total = debts.reduce((s, d) => s + d.balance, 0), mins = debts.reduce((s, d) => s + d.minPayment, 0);
    const stuck = plan.neverPaidOff.length > 0;
    const saved = baseline.totalInterest - plan.totalInterest;
    const strategyCards = [['base', 'Minimums only', baseline], ['avalanche', 'Avalanche', plans.avalanche], ['snowball', 'Snowball', plans.snowball]].map(([k, name, p]) => {
      const never = p.neverPaidOff.length > 0;
      const best = k !== 'base' && k === (plans.avalanche.totalInterest <= plans.snowball.totalInterest ? 'avalanche' : 'snowball') && extra > 0;
      return `<div class="${best ? 'best' : ''}"><b>${name}</b>${best ? ' <span class="pill">cheapest</span>' : ''}
        <div class="muted" style="font-size:.8rem">${k === 'avalanche' ? 'Highest APR first' : k === 'snowball' ? 'Smallest balance first' : 'No extra, no rollover'}</div>
        <div class="num" style="font-size:1.2rem;font-weight:650;margin-top:6px">${never ? 'Never' : inMonths(p.months)}</div>
        <div class="muted" style="font-size:.85rem">${never ? 'payments too low' : `${durationLabel(p.months)} · ${money0(p.totalInterest)} interest`}</div></div>`;
    }).join('');
    return `${head}
      <div class="tiles">${tile('Total debt', money0(total), `${debts.length} account${debts.length === 1 ? '' : 's'}`, 'neg')}${tile('Monthly minimums', money0(mins), extra ? `+ ${money0(extra)} extra` : '')}
        ${tile('Debt-free', stuck ? 'Not yet' : inMonths(plan.months), stuck ? 'raise payments' : durationLabel(plan.months))}${tile('Interest saved', money0(Math.max(0, saved)), 'vs minimums only')}</div>
      <section class="card" style="margin-bottom:16px"><div class="card-head"><h2>Payoff plan</h2>
        <div class="head-tools"><label style="display:flex;gap:8px;align-items:center">Extra / month $<input type="number" min="0" step="10" value="${extra}" data-change="extra" style="width:110px;margin:0"></label>
        <span class="seg-btns" role="group" aria-label="Strategy"><button data-strategy="avalanche" aria-pressed="${strat === 'avalanche'}">Avalanche</button><button data-strategy="snowball" aria-pressed="${strat === 'snowball'}">Snowball</button></span></div></div>
        ${stuck ? `<div class="notice">⚠️ At the current payments, ${plan.neverPaidOff.map((id) => esc(debts.find((d) => d.id === id)?.name)).join(', ')} never gets paid off (interest ≥ payment). Increase the minimum or add extra.</div>` : ''}
        <div class="strategy" style="margin-bottom:14px">${strategyCards}</div>
        ${lineChart([{ name: 'Minimums only', color: '#a0a7ae', dash: true, points: baseline.timeline }, { name: strat === 'avalanche' ? 'Avalanche' : 'Snowball', color: '#0e9f6e', points: plan.timeline }])}</section>
      <div class="grid cols-2">${debts.map((d) => debtCard(d, plan)).join('')}</div>`;
  }
  function debtCard(d, plan) {
    const t = DEBT_TYPES[d.type] || DEBT_TYPES.other;
    const paid = d.original > 0 ? Math.min(1, Math.max(0, 1 - d.balance / d.original)) : 0;
    const solo = C.payoffPlan([d], { extra: 0 });
    const pm = plan.payoffMonth[d.id];
    const monthlyInterest = d.balance * d.apr / 1200;
    const warn = d.balance > 0 && d.minPayment <= monthlyInterest;
    const hist = [...(d.payments || [])].reverse();
    return `<section class="card debt"><div class="row"><h3>${t.icon} ${esc(d.name)}</h3><span class="pill ${d.balance <= 0 ? '' : 'warn'}">${d.balance <= 0 ? 'Paid off 🎉' : d.apr + '% APR'}</span></div>
      <div class="amounts num" style="font-size:1.4rem;font-weight:650;margin-top:4px">${money(d.balance)} <span class="muted" style="font-size:.85rem;font-weight:400">of ${money0(d.original)}</span></div>
      <div class="bar" style="margin-top:6px" aria-label="${Math.round(paid * 100)}% paid"><i style="width:${paid * 100}%"></i></div>
      ${warn ? `<div class="notice" style="margin-top:10px">Minimum ${money0(d.minPayment)} doesn't cover this month's interest (${money(monthlyInterest)}).</div>` : ''}
      <div class="debt-stats"><div class="muted">Min payment<b class="num">${money(d.minPayment)}</b></div><div class="muted">Interest / month<b class="num">${money(monthlyInterest)}</b></div>
        <div class="muted">Paid off<b>${d.balance <= 0 ? 'Done' : pm ? inMonths(pm) : 'Never'}</b></div>
        <div class="muted">Lifetime interest<b class="num">${solo.neverPaidOff.length ? '∞' : money0(solo.totalInterest)}</b></div></div>
      <div class="actions">${d.balance > 0 ? `<button class="btn primary sm" data-action="pay-debt" data-id="${d.id}">Record payment</button>` : ''}<button class="btn sm" data-action="edit-debt" data-id="${d.id}">Edit</button><button class="btn sm danger" data-action="del-debt" data-id="${d.id}">Delete</button></div>
      ${hist.length ? `<details><summary>${hist.length} payment${hist.length === 1 ? '' : 's'} logged</summary><table>${hist.slice(0, 12).map((p) => `<tr><td class="muted">${dateLabel(p.date)}</td><td class="r num">${money(p.amount)}</td><td class="r muted num">${money(p.principal)} principal</td><td class="r muted num">${money(p.interest)} interest</td></tr>`).join('')}</table></details>` : ''}</section>`;
  }

  /* ---------- CSV import ---------- */
  function startImport(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => toast('Could not read that file.');
    reader.onload = () => importDialog(String(reader.result), file.name);
    reader.readAsText(file);
  }

  function importDialog(text, filename) {
    const rows = C.parseCSV(text);
    if (rows.length < 2) { toast('That file has no data rows.'); return; }
    const guess = C.detectColumns(rows[0]);
    const looksLikeHeader = guess.date >= 0 || guess.amount >= 0 || guess.desc >= 0;
    const width = Math.max(...rows.slice(0, 50).map((r) => r.length));
    const colName = (i) => (looksLikeHeader && rows[0][i] ? rows[0][i] : `Column ${i + 1}`);
    const opts = (sel, optional) => (optional ? `<option value="-1">— none —</option>` : '') + Array.from({ length: width }, (_, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(colName(i))}</option>`).join('');
    const body = `<p class="muted" style="margin-top:0">${esc(filename)} · ${rows.length - 1} rows. Check the columns below.</p>
      <div class="field-row">
        <label>Date<select name="date">${opts(guess.date)}</select></label>
        <label>Description<select name="desc">${opts(guess.desc)}</select></label>
        <label>Amount<select name="amount">${opts(guess.amount, true)}</select></label>
        <label>Debit (money out)<select name="debit">${opts(guess.debit, true)}</select></label>
        <label>Credit (money in)<select name="credit">${opts(guess.credit, true)}</select></label>
        <label>Category (optional)<select name="category">${opts(guess.category, true)}</select></label></div>
      <div class="field-row"><label>Date format<select name="fmt"><option value="mdy">Month/Day/Year (US)</option><option value="dmy">Day/Month/Year</option></select></label></div>
      <label class="check"><input type="checkbox" name="header" ${looksLikeHeader ? 'checked' : ''}> First row is a header</label>
      <label class="check"><input type="checkbox" name="invert"> Positive amounts are spending (some credit-card exports)</label>
      <div id="impSummary" style="margin:10px 0"></div><div class="preview" id="impPreview"></div>`;
    let current = { txns: [], fresh: [] };
    const compute = (form) => {
      const g = (n) => form.elements[n];
      const map = { date: +g('date').value, desc: +g('desc').value, amount: +g('amount').value, debit: +g('debit').value, credit: +g('credit').value, category: +g('category').value };
      const res = C.rowsToTransactions(rows, map, { hasHeader: g('header').checked, dateFormat: g('fmt').value, invert: g('invert').checked, custom: state.rules });
      const have = new Set(state.transactions.map(C.txnKey));
      const fresh = res.txns.filter((t) => { const k = C.txnKey(t); if (have.has(k)) return false; have.add(k); return true; });
      current = { txns: res.txns, fresh };
      const pos = res.txns.filter((t) => t.amount > 0).length;
      $('#impSummary', form).innerHTML = `<b>${fresh.length}</b> new transaction${fresh.length === 1 ? '' : 's'} to import`
        + (res.txns.length - fresh.length ? ` · ${res.txns.length - fresh.length} duplicate${res.txns.length - fresh.length === 1 ? '' : 's'} skipped` : '')
        + (res.skipped.length ? ` · <span class="neg">${res.skipped.length} unreadable row${res.skipped.length === 1 ? '' : 's'}</span>` : '')
        + (res.txns.length > 4 && pos === res.txns.length ? '<div class="notice" style="margin-top:8px">Every amount is positive. If these are purchases, tick “Positive amounts are spending”.</div>' : '');
      $('#impPreview', form).innerHTML = `<table><thead><tr><th>Date</th><th>Description</th><th>Category</th><th class="r">Amount</th></tr></thead><tbody>${fresh.slice(0, 8).map((t) => `<tr><td>${t.date}</td><td>${esc(t.desc)}</td><td>${esc(t.category)}</td><td class="r num">${money(t.amount)}</td></tr>`).join('')}</tbody></table>`;
    };
    openModal('Import transactions', body, () => {
      if (!current.fresh.length) { toast('Nothing new to import.'); return false; }
      current.fresh.forEach((t) => state.transactions.push({ id: uid(), ...t }));
      save(); ui.tx.month = 'all'; ui.month = current.fresh.map((t) => C.monthOf(t.date)).sort().pop();
      toast(`Imported ${current.fresh.length} transactions`); go('reports');
    }, { submit: 'Import', noFocus: true, onOpen: (form) => { form.addEventListener('change', () => compute(form)); compute(form); } });
  }

  /* ---------- forms ---------- */
  function txForm() {
    openModal('Add transaction', `<div class="field-row">${fld('Date', 'date', todayISO(), 'type="date" required')}${fld('Amount', 'amount', '', 'type="number" step="0.01" min="0.01" required inputmode="decimal"')}</div>
      <div class="field-row">${fld('Description', 'desc', '', 'required')}<label>Type<select name="kind"><option value="out">Expense</option><option value="in">Income</option></select></label></div>
      <label>Category (leave on Auto to guess)<select name="cat"><option value="">Auto</option>${catOptions()}</select></label>`, (fd) => {
      const kind = fd.get('kind'), amt = Math.abs(parseFloat(fd.get('amount'))) * (kind === 'in' ? 1 : -1), desc = fd.get('desc').trim();
      state.transactions.push({ id: uid(), date: fd.get('date'), desc, amount: amt, category: fd.get('cat') || C.categorize(desc, amt, state.rules) });
      save(); render(); toast('Transaction added');
    });
  }

  function bucketForm(b) {
    openModal(b ? 'Edit bucket' : 'New savings bucket', `${fld('Name', 'name', b?.name, 'required placeholder="Emergency fund"')}
      <div class="field-row">${fld('Goal ($)', 'goal', b?.goal ?? '', 'type="number" min="1" step="1" required')}${fld('Already saved ($)', 'saved', b?.saved ?? 0, 'type="number" min="0" step="0.01"')}${fld('Monthly contribution ($, optional)', 'monthly', b?.monthly ?? '', 'type="number" min="0" step="1"')}</div>
      <label>Colour<select name="color">${BUCKET_COLORS.map((c, i) => `<option value="${c}" ${(b?.color || BUCKET_COLORS[state.buckets.length % 6]) === c ? 'selected' : ''} style="color:${c}">● ${['Green', 'Blue', 'Amber', 'Pink', 'Purple', 'Teal'][i]}</option>`).join('')}</select></label>
      ${b ? `<p><button type="button" class="link danger" id="delBucket">Delete this bucket</button></p>` : ''}`, (fd) => {
      const data = { name: fd.get('name').trim(), goal: +fd.get('goal'), saved: Math.max(0, +fd.get('saved') || 0), monthly: +fd.get('monthly') || 0, color: fd.get('color') };
      if (b) Object.assign(b, data); else state.buckets.push({ id: uid(), ...data });
      save(); render(); toast(b ? 'Bucket updated' : 'Bucket created');
    }, { onOpen: (form) => { const del = $('#delBucket', form); if (del) del.onclick = () => { if (confirm(`Delete “${b.name}”?`)) { state.buckets = state.buckets.filter((x) => x !== b); save(); modal.close(); render(); } }; } });
  }

  function moveMoney(b, sign) {
    openModal(`${sign > 0 ? 'Deposit into' : 'Withdraw from'} ${b.name}`, `${fld('Amount ($)', 'amt', '', `type="number" step="0.01" min="0.01" ${sign < 0 ? `max="${b.saved}"` : ''} required inputmode="decimal"`)}
      <p class="muted">${money(b.saved)} saved of ${money0(b.goal)}</p>`, (fd) => {
      const amt = Math.round(parseFloat(fd.get('amt')) * 100) / 100, before = bucketPct(b);
      b.saved = Math.max(0, Math.round((b.saved + sign * amt) * 100) / 100);
      save(); render();
      if (sign > 0) { dropCash(b.id, Math.min(14, 4 + Math.round(amt / Math.max(10, b.goal / 20)))); if (before < 1 && bucketPct(b) >= 1) setTimeout(() => confetti(b.id), 900); }
      toast(sign > 0 ? `Added ${money(amt)} – ${milestone(bucketPct(b))}` : `Withdrew ${money(amt)}`);
    }, { submit: sign > 0 ? 'Deposit' : 'Withdraw' });
  }

  function debtForm(d) {
    const typeOpts = Object.entries(DEBT_TYPES).map(([k, v]) => `<option value="${k}" ${(d?.type || 'mortgage') === k ? 'selected' : ''}>${v.icon} ${v.label}</option>`).join('');
    openModal(d ? 'Edit debt' : 'Add a debt', `<div class="field-row">${fld('Name', 'name', d?.name, 'required placeholder="Home mortgage"')}<label>Type<select name="type">${typeOpts}</select></label></div>
      <div class="field-row">${fld('Current balance ($)', 'balance', d?.balance ?? '', 'type="number" min="0" step="0.01" required')}${fld('Original balance ($)', 'original', d?.original ?? '', 'type="number" min="0" step="0.01" placeholder="same as current"')}</div>
      <div class="field-row">${fld('Interest rate (APR %)', 'apr', d?.apr ?? '', 'type="number" min="0" max="100" step="0.01" required')}${fld('Minimum monthly payment ($)', 'min', d?.minPayment ?? '', 'type="number" min="0" step="0.01" required')}</div>
      <p class="muted" style="font-size:.85rem">For a mortgage enter just principal &amp; interest – leave out escrow (taxes/insurance). Interest is calculated monthly at APR ÷ 12.</p>`, (fd) => {
      const balance = +fd.get('balance');
      const data = { name: fd.get('name').trim(), type: fd.get('type'), balance, original: Math.max(+fd.get('original') || balance, balance), apr: +fd.get('apr'), minPayment: +fd.get('min') };
      if (d) Object.assign(d, data); else state.debts.push({ id: uid(), payments: [], ...data });
      save(); render(); toast(d ? 'Debt updated' : 'Debt added');
    });
    const typeSel = $('[name=type]', $('#modalForm'));
    if (!d) typeSel.onchange = () => { const a = $('[name=apr]'); if (!a.value) a.value = DEBT_TYPES[typeSel.value].apr; };
  }

  function payForm(d) {
    openModal(`Payment on ${d.name}`, `<div class="field-row">${fld('Amount ($)', 'amt', d.minPayment, 'type="number" min="0.01" step="0.01" required')}${fld('Date', 'date', todayISO(), 'type="date" required')}</div>
      <div id="paySplit" class="muted" style="margin-bottom:8px"></div>
      <label class="check"><input type="checkbox" name="log"> Also add to transactions as “Debt Payments”</label>
      <p class="muted" style="font-size:.8rem">Each payment first covers one month of interest (${d.apr}% APR), the rest reduces your balance. Leave the box unticked if the payment is already in a CSV you import.</p>`, (fd) => {
      const amt = Math.round(parseFloat(fd.get('amt')) * 100) / 100, s = C.splitPayment(d.balance, d.apr, amt);
      d.balance = s.newBalance; (d.payments ||= []).push({ date: fd.get('date'), amount: amt, interest: s.interest, principal: s.principal });
      if (fd.get('log')) state.transactions.push({ id: uid(), date: fd.get('date'), desc: `Payment – ${d.name}`, amount: -amt, category: 'Debt Payments' });
      save(); render(); toast(d.balance <= 0 ? `🎉 ${d.name} is paid off!` : `${money(s.principal)} off the principal`);
    }, { submit: 'Record payment', onOpen: (form) => {
      const upd = () => { const a = parseFloat(form.elements.amt.value); if (a > 0) { const s = C.splitPayment(d.balance, d.apr, a); $('#paySplit', form).textContent = `${money(s.principal)} principal · ${money(s.interest)} interest → new balance ${money(s.newBalance)}`; } };
      form.elements.amt.addEventListener('input', upd); upd(); } });
  }

  function budgetsForm() {
    const cats = C.CATEGORIES.filter((c) => c !== 'Income' && c !== 'Transfer');
    openModal('Monthly budgets', `<p class="muted" style="margin-top:0">Set a monthly limit per category. Leave blank for none. Reports flag any category that goes over.</p><div class="field-row">${cats.map((c) => fld(c, 'b_' + c, state.budgets[c] || '', 'type="number" min="0" step="10"')).join('')}</div>`, (fd) => {
      state.budgets = {}; cats.forEach((c) => { const v = +fd.get('b_' + c); if (v > 0) state.budgets[c] = v; });
      save(); render();
    });
  }

  /* ---------- sample data ---------- */
  function loadSample() {
    if (!isEmpty() && !confirm('Add sample data alongside your existing data?')) return;
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const now = todayISO().slice(0, 7), out = [];
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    for (let k = 3; k >= 0; k--) {
      const ym = C.addMonths(now, -k), day = (n) => `${ym}-${String(Math.min(28, n)).padStart(2, '0')}`;
      out.push([day(1), 'ACME CORP PAYROLL', 3150], [day(15), 'ACME CORP PAYROLL', 3150], [day(1), 'Rent - Maple Apartments', -1450], [day(5), 'City Electric', -(70 + rnd() * 50)], [day(7), 'Comcast Internet', -69.99], [day(9), 'Verizon Wireless', -55],
        [day(3), 'Netflix', -15.49], [day(3), 'Spotify', -10.99], [day(12), 'Planet Fitness gym', -24.99], [day(10), 'Navient Student Loan', -215], [day(11), 'Toyota Financial Auto Loan', -389]);
      for (let i = 0; i < 6; i++) out.push([day(2 + i * 5), pick(['Kroger #112', 'Whole Foods Market', 'Trader Joes', 'Aldi']), -(45 + rnd() * 90)]);
      for (let i = 0; i < 9; i++) out.push([day(1 + i * 3), pick(['Starbucks', 'Chipotle', 'DoorDash', 'Local Pizza Co', 'Dunkin']), -(6 + rnd() * 28)]);
      for (let i = 0; i < 4; i++) out.push([day(4 + i * 7), pick(['Shell Gas Station', 'Chevron', 'Uber trip']), -(20 + rnd() * 35)]);
      for (let i = 0; i < 3; i++) out.push([day(6 + i * 9), pick(['Amazon.com', 'Target', 'Best Buy', 'IKEA']), -(18 + rnd() * 95)]);
      out.push([day(20), 'AMC Theatres', -(24 + rnd() * 10)], [day(22), 'CVS Pharmacy', -(12 + rnd() * 20)]);
      if (k % 2 === 0) out.push([day(18), 'Delta Airlines', -(210 + rnd() * 120)]);
    }
    const today = todayISO();
    out.filter(([d]) => d <= today).forEach(([date, desc, amt]) => { amt = Math.round(amt * 100) / 100; state.transactions.push({ id: uid(), date, desc, amount: amt, category: C.categorize(desc, amt, state.rules) }); });
    if (!state.buckets.length) state.buckets.push(
      { id: uid(), name: 'Emergency fund', goal: 10000, saved: 6250, monthly: 400, color: BUCKET_COLORS[0] },
      { id: uid(), name: 'Hawaii vacation', goal: 4000, saved: 1100, monthly: 250, color: BUCKET_COLORS[1] },
      { id: uid(), name: 'Down payment', goal: 40000, saved: 3200, monthly: 600, color: BUCKET_COLORS[2] });
    if (!state.debts.length) state.debts.push(
      { id: uid(), name: 'Home mortgage', type: 'mortgage', balance: 248000, original: 280000, apr: 6.25, minPayment: 1724, payments: [] },
      { id: uid(), name: 'Federal student loans', type: 'student', balance: 18500, original: 26000, apr: 5.5, minPayment: 215, payments: [] },
      { id: uid(), name: 'Car loan', type: 'car', balance: 14200, original: 22000, apr: 7.2, minPayment: 389, payments: [] },
      { id: uid(), name: 'Credit card', type: 'card', balance: 3100, original: 5200, apr: 22.9, minPayment: 95, payments: [] });
    state.settings.extra = state.settings.extra || 200;
    ui.month = null; save(); render(); toast('Sample data loaded');
  }

  /* ---------- exports ---------- */
  function download(name, text, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const csvCell = (v) => { let s = String(v); if (/^[=+\-@]/.test(s) && isNaN(+s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  function exportReport() {
    const ym = focusMonth(), r = C.monthlyReport(state.transactions, ym);
    const lines = [['Budget IO report', monthLabel(ym)], ['Income', r.income], ['Spending', r.spending], ['Net', r.net], [], ['Category', 'Amount', 'Share', 'Budget']]
      .concat(r.categories.map((c) => [c.name, c.total, (c.pct * 100).toFixed(1) + '%', state.budgets[c.name] || '']));
    download(`budget-io-${ym}.csv`, lines.map((l) => l.map(csvCell).join(',')).join('\n'), 'text/csv');
  }

  /* ---------- events ---------- */
  const find = (list, id) => list.find((x) => x.id === id);
  const actions = {
    import: () => $('#csvFile').click(),
    'add-tx': txForm,
    'add-bucket': () => bucketForm(),
    'add-debt': () => debtForm(),
    sample: loadSample,
    print: () => window.print(),
    budgets: budgetsForm,
    'export-report': exportReport,
    'export-json': () => download(`budget-io-backup-${todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json'),
    'import-json': () => $('#jsonFile').click(),
    reset: () => { if (confirm('Delete ALL Budget IO data in this browser? This cannot be undone.')) { state = blank(); ui.lastPct = {}; save(); go('dashboard'); toast('All data cleared'); } },
    deposit: (el) => moveMoney(find(state.buckets, el.dataset.id), 1),
    withdraw: (el) => moveMoney(find(state.buckets, el.dataset.id), -1),
    'edit-bucket': (el) => bucketForm(find(state.buckets, el.dataset.id)),
    'edit-debt': (el) => debtForm(find(state.debts, el.dataset.id)),
    'pay-debt': (el) => payForm(find(state.debts, el.dataset.id)),
    'del-debt': (el) => { const d = find(state.debts, el.dataset.id); if (confirm(`Delete “${d.name}”?`)) { state.debts = state.debts.filter((x) => x !== d); save(); render(); } },
    'del-tx': (el) => { state.transactions = state.transactions.filter((t) => t.id !== el.dataset.id); save(); $('#txList').innerHTML = txList(); },
    'more-tx': () => { ui.tx.limit += 200; $('#txList').innerHTML = txList(); },
  };

  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-action]');
    if (a && actions[a.dataset.action]) return actions[a.dataset.action](a);
    const t = e.target.closest('[data-tab]'); if (t) return go(t.dataset.tab);
    const g = e.target.closest('[data-tab-go]'); if (g) return go(g.dataset.tabGo);
    const s = e.target.closest('[data-strategy]'); if (s) { state.settings.strategy = s.dataset.strategy; save(); render(); }
  });
  document.addEventListener('input', (e) => {
    if (e.target.dataset.input === 'txq') { ui.tx.q = e.target.value; ui.tx.limit = 100; $('#txList').innerHTML = txList(); }
  });
  document.addEventListener('change', (e) => {
    const el = e.target, k = el.dataset.change; if (!k) return;
    if (k === 'month') { ui.month = el.value; render(); }
    else if (k === 'txmonth') { ui.tx.month = el.value; ui.tx.limit = 100; $('#txList').innerHTML = txList(); }
    else if (k === 'txfcat') { ui.tx.cat = el.value; ui.tx.limit = 100; $('#txList').innerHTML = txList(); }
    else if (k === 'extra') { state.settings.extra = Math.max(0, +el.value || 0); save(); render(); }
    else if (k === 'txcat') {
      const t = find(state.transactions, el.dataset.id); if (!t) return;
      t.category = el.value;
      const key = C.merchantKey(t.desc); let n = 0;
      if (key.length > 2) {
        state.rules[key] = el.value;
        state.transactions.forEach((o) => { if (o !== t && o.category === 'Other' && o.amount < 0 && C.merchantKey(o.desc) === key) { o.category = el.value; n++; } });
      }
      save(); if (n) { $('#txList').innerHTML = txList(); toast(`Also moved ${n} similar “Other” transaction${n === 1 ? '' : 's'} – I’ll remember “${key}”`); } else toast('Category saved');
    }
  });
  $('#csvFile').addEventListener('change', (e) => { startImport(e.target.files[0]); e.target.value = ''; });
  $('#jsonFile').addEventListener('change', (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        if (!Array.isArray(data.transactions) || !Array.isArray(data.buckets) || !Array.isArray(data.debts)) throw new Error('bad shape');
        if (!confirm('Replace all current data with this backup?')) return;
        state = Object.assign(blank(), data); ui.lastPct = {}; save(); go('dashboard'); toast('Backup restored');
      } catch { toast('That does not look like a Budget IO backup.'); }
    };
    r.readAsText(f);
  });
  // drag & drop CSV anywhere
  ['dragenter', 'dragover'].forEach((ev) => window.addEventListener(ev, (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); document.body.classList.add('dragging'); } }));
  ['dragleave', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => { if (ev === 'dragleave' && e.relatedTarget) return; document.body.classList.remove('dragging'); }));
  window.addEventListener('drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (f) { e.preventDefault(); if (/\.(csv|txt)$/i.test(f.name) || f.type.includes('csv')) startImport(f); else toast('Please drop a .csv file.'); } });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });

  const hash = location.hash.slice(1);
  if (views[hash]) ui.tab = hash;
  render();
})();
