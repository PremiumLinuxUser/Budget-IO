/* Budget IO core logic: CSV parsing, categorisation, reports and debt payoff maths.
 * Pure functions, no DOM access, so it runs in the browser and under Node tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BudgetCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- CSV ---------- */

  function detectDelimiter(text) {
    const line = text.split(/\r?\n/).find((l) => l.trim()) || '';
    let best = ',', bestN = -1;
    for (const d of [',', ';', '\t', '|']) {
      let n = 0, q = false;
      for (const ch of line) { if (ch === '"') q = !q; else if (ch === d && !q) n++; }
      if (n > bestN) { bestN = n; best = d; }
    }
    return best;
  }

  /** Parse CSV text into an array of string arrays. Handles quotes, escaped quotes and embedded newlines. */
  function parseCSV(text) {
    text = String(text).replace(/^﻿/, '');
    const d = detectDelimiter(text);
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
        } else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === d) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        rows.push(row); row = [];
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
  }

  /** Guess which column holds what, from header names. Returns indexes or -1. */
  function detectColumns(header) {
    const find = (re, skip = []) => header.findIndex((h, i) => !skip.includes(i) && re.test(h.trim()));
    const date = find(/date|posted|time/i);
    const debit = find(/debit|withdraw|paid out|money out|outflow/i);
    const credit = find(/credit|deposit|paid in|money in|inflow/i);
    const amount = find(/amount|amt|value|total/i, [debit, credit]);
    const desc = find(/desc|memo|payee|merchant|name|detail|narrat|reference/i, [date]);
    const category = find(/categ/i);
    return { date, desc, amount, debit, credit, category };
  }

  function parseAmount(raw) {
    if (raw == null) return NaN;
    let s = String(raw).trim();
    if (!s) return NaN;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
    if (/\bDR\b/i.test(s)) neg = true;
    s = s.replace(/\b(CR|DR)\b/gi, '').replace(/[^\d.,-]/g, '');
    if (s.startsWith('-')) { neg = true; s = s.slice(1); }
    // European style 1.234,56 -> 1234.56 ; otherwise strip thousands commas
    if (/,\d{1,2}$/.test(s) && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
    const n = parseFloat(s);
    if (isNaN(n)) return NaN;
    return neg ? -Math.abs(n) : n;
  }

  const pad = (n) => String(n).padStart(2, '0');
  function validYMD(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  /** fmt: 'mdy' (default) or 'dmy' for slash/dash dates. ISO dates are always read as y-m-d. */
  function parseDate(raw, fmt = 'mdy') {
    if (!raw) return null;
    const s = String(raw).trim();
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return validYMD(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})/);
    if (m) {
      let a = +m[1], b = +m[2], y = +m[3];
      if (m[3].length === 2) y += 2000;
      let mo = fmt === 'dmy' ? b : a, dd = fmt === 'dmy' ? a : b;
      let r = validYMD(y, mo, dd);
      if (!r) r = validYMD(y, dd, mo); // forgiving swap if the chosen order is impossible
      return r;
    }
    const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
    if (m && MONTHS.includes(m[1].toLowerCase())) return validYMD(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]);
    m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})/);
    if (m && MONTHS.includes(m[2].toLowerCase())) return validYMD(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
    return null;
  }

  /* ---------- Categories ---------- */

  const CATEGORIES = [
    'Income', 'Housing', 'Utilities', 'Groceries', 'Dining', 'Transport', 'Shopping', 'Entertainment',
    'Subscriptions', 'Health', 'Travel', 'Education', 'Debt Payments', 'Savings', 'Transfer', 'Other',
  ];

  const DEFAULT_RULES = [
    ['Income', ['payroll', 'direct dep', 'salary', 'paycheck', 'interest paid', 'dividend', 'refund from employer']],
    ['Housing', ['rent', 'mortgage', 'hoa', 'property tax', 'home depot', 'lowes', 'lowe\'s']],
    ['Utilities', ['electric', 'water', 'gas bill', 'utility', 'internet', 'comcast', 'xfinity', 'verizon', 'at&t', 'tmobile', 't-mobile', 'spectrum', 'power co']],
    ['Groceries', ['grocery', 'kroger', 'safeway', 'whole foods', 'trader joe', 'aldi', 'publix', 'walmart', 'costco', 'wegmans', 'heb ', 'sprouts', 'market']],
    ['Dining', ['restaurant', 'cafe', 'coffee', 'starbucks', 'mcdonald', 'chipotle', 'pizza', 'burger', 'doordash', 'uber eats', 'grubhub', 'taco', 'sushi', 'bar & grill', 'diner', 'dunkin']],
    ['Transport', ['uber', 'lyft', 'shell', 'chevron', 'exxon', 'bp ', 'fuel', 'gas station', 'parking', 'transit', 'metro', 'toll', 'auto parts', 'geico', 'progressive ins']],
    ['Shopping', ['amazon', 'target', 'best buy', 'ebay', 'etsy', 'nike', 'ikea', 'apple store', "macy's", 'macys', 'old navy']],
    ['Entertainment', ['cinema', 'theater', 'theatre', 'amc', 'steam', 'playstation', 'xbox', 'concert', 'ticketmaster', 'bowling']],
    ['Subscriptions', ['netflix', 'spotify', 'hulu', 'disney', 'youtube', 'prime video', 'hbo', 'apple.com/bill', 'icloud', 'patreon', 'subscription', 'adobe', 'dropbox', 'gym', 'fitness']],
    ['Health', ['pharmacy', 'cvs', 'walgreens', 'doctor', 'dental', 'clinic', 'hospital', 'medical', 'vision', 'health']],
    ['Travel', ['airline', 'airlines', 'delta', 'united air', 'southwest', 'hotel', 'airbnb', 'marriott', 'hilton', 'expedia', 'booking.com']],
    ['Education', ['tuition', 'university', 'college', 'udemy', 'coursera', 'bookstore', 'school']],
    ['Debt Payments', ['student loan', 'navient', 'nelnet', 'mohela', 'auto loan', 'car payment', 'credit card payment', 'loan payment', 'sallie mae', 'toyota financial', 'honda financial']],
    ['Savings', ['savings transfer', 'to savings', 'investment', 'vanguard', 'fidelity', 'robinhood', '401k']],
    ['Transfer', ['transfer', 'zelle', 'venmo', 'cash app', 'paypal']],
  ];

  /** Return the category for a description. `custom` is an object {keyword: category} learned from the user. */
  function categorize(desc, amount, custom = {}) {
    const d = String(desc || '').toLowerCase();
    for (const [kw, cat] of Object.entries(custom)) if (kw && d.includes(kw)) return cat;
    for (const [cat, words] of DEFAULT_RULES) {
      if (cat === 'Income' && amount < 0) continue;
      for (const w of words) if (d.includes(w)) return cat;
    }
    return amount > 0 ? 'Income' : 'Other';
  }

  /** A short, stable key for "same merchant" matching: first two alphabetic words. */
  function merchantKey(desc) {
    const words = String(desc || '').toLowerCase().replace(/[^a-z&' ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1);
    return words.slice(0, 2).join(' ');
  }

  /* ---------- Importing ---------- */

  const txnKey = (t) => `${t.date}|${t.amount.toFixed(2)}|${t.desc.toLowerCase().replace(/\s+/g, ' ')}`;

  /**
   * Convert parsed CSV rows into transactions.
   * map: {date, desc, amount, debit, credit, category} column indexes (-1 = unused)
   * opts: {hasHeader, dateFormat, invert, custom}
   * Returns {txns, skipped} where skipped lists rows that could not be read.
   */
  function rowsToTransactions(rows, map, opts = {}) {
    const start = opts.hasHeader === false ? 0 : 1;
    const txns = [], skipped = [];
    for (let i = start; i < rows.length; i++) {
      const r = rows[i];
      const date = parseDate(r[map.date], opts.dateFormat);
      let amount = NaN;
      if (map.amount >= 0) amount = parseAmount(r[map.amount]);
      if (isNaN(amount) && (map.debit >= 0 || map.credit >= 0)) {
        const dr = map.debit >= 0 ? parseAmount(r[map.debit]) : NaN;
        const cr = map.credit >= 0 ? parseAmount(r[map.credit]) : NaN;
        if (!isNaN(dr) && dr !== 0) amount = -Math.abs(dr);
        else if (!isNaN(cr) && cr !== 0) amount = Math.abs(cr);
        else if (!isNaN(dr) || !isNaN(cr)) amount = 0;
      }
      const desc = (map.desc >= 0 ? (r[map.desc] || '') : '').trim().replace(/\s+/g, ' ') || '(no description)';
      if (!date || isNaN(amount)) { skipped.push(i + 1); continue; }
      if (opts.invert) amount = -amount;
      amount = Math.round(amount * 100) / 100;
      let category = map.category >= 0 ? (r[map.category] || '').trim() : '';
      const known = CATEGORIES.find((c) => c.toLowerCase() === category.toLowerCase());
      category = known || categorize(desc, amount, opts.custom);
      txns.push({ date, desc, amount, category });
    }
    return { txns, skipped };
  }

  /* ---------- Reports ---------- */

  const monthOf = (date) => date.slice(0, 7);

  function addMonths(ym, n) {
    const [y, m] = ym.split('-').map(Number);
    const t = y * 12 + (m - 1) + n;
    return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
  }

  function monthlyReport(txns, ym) {
    const list = txns.filter((t) => monthOf(t.date) === ym);
    let income = 0, spending = 0;
    const byCat = {};
    for (const t of list) {
      if (t.category === 'Transfer') continue;
      if (t.category === 'Income') income += t.amount;
      else { byCat[t.category] = (byCat[t.category] || 0) - t.amount; spending -= t.amount; }
    }
    const categories = Object.entries(byCat)
      .map(([name, total]) => ({ name, total: round2(total) }))
      .filter((c) => c.total > 0)
      .sort((a, b) => b.total - a.total);
    const spendTotal = categories.reduce((s, c) => s + c.total, 0);
    categories.forEach((c) => (c.pct = spendTotal ? c.total / spendTotal : 0));
    const biggest = list
      .filter((t) => t.amount < 0 && t.category !== 'Transfer')
      .sort((a, b) => a.amount - b.amount)
      .slice(0, 5);
    return {
      month: ym,
      count: list.length,
      income: round2(income),
      spending: round2(spendTotal),
      net: round2(income - spendTotal),
      savingsRate: income > 0 ? (income - spendTotal) / income : null,
      categories,
      biggest,
    };
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  /* ---------- Debt payoff ---------- */

  /**
   * Simulate paying off debts month by month.
   * debts: [{id, balance, apr, minPayment}]   apr is a percentage, e.g. 6.5
   * opts.extra     extra money per month on top of all minimums
   * opts.strategy  'avalanche' (highest APR first) | 'snowball' (smallest balance first)
   * opts.rollover  when true, minimums of paid-off debts are re-used (default true)
   * Returns {months, totalInterest, totalPaid, timeline[], payoffMonth{id:n}, neverPaidOff[]}
   */
  function payoffPlan(debts, opts = {}) {
    const extra = Math.max(0, +opts.extra || 0);
    const strategy = opts.strategy || 'avalanche';
    const rollover = opts.rollover !== false;
    const ds = debts.filter((d) => d.balance > 0.005).map((d) => ({
      id: d.id, bal: d.balance, rate: (d.apr || 0) / 1200, min: Math.max(0, d.minPayment || 0),
    }));
    const budget = ds.reduce((s, d) => s + d.min, 0) + extra;
    const timeline = [round2(ds.reduce((s, d) => s + d.bal, 0))];
    const payoffMonth = {};
    let month = 0, totalInterest = 0, totalPaid = 0;
    const CAP = 1200; // 100 years
    while (ds.some((d) => d.bal > 0.005) && month < CAP) {
      month++;
      for (const d of ds) if (d.bal > 0.005) { const i = d.bal * d.rate; d.bal += i; totalInterest += i; }
      let pool = rollover ? budget : ds.reduce((s, d) => s + (d.bal > 0.005 ? d.min : 0), 0) + extra;
      for (const d of ds) {
        if (d.bal <= 0.005) continue;
        const p = Math.min(d.min, d.bal, pool);
        d.bal -= p; pool -= p; totalPaid += p;
      }
      const order = ds.filter((d) => d.bal > 0.005).sort((a, b) =>
        strategy === 'snowball' ? a.bal - b.bal : b.rate - a.rate || a.bal - b.bal);
      for (const d of order) {
        if (pool <= 0.005) break;
        const p = Math.min(d.bal, pool);
        d.bal -= p; pool -= p; totalPaid += p;
      }
      for (const d of ds) if (d.bal <= 0.005 && payoffMonth[d.id] == null) { d.bal = 0; payoffMonth[d.id] = month; }
      timeline.push(round2(ds.reduce((s, d) => s + d.bal, 0)));
    }
    const neverPaidOff = ds.filter((d) => d.bal > 0.005).map((d) => d.id);
    return {
      months: month, totalInterest: round2(totalInterest), totalPaid: round2(totalPaid),
      timeline, payoffMonth, neverPaidOff, budget: round2(budget),
    };
  }

  /** Split a payment into interest and principal for one month of accrued interest. */
  function splitPayment(balance, apr, payment) {
    const interest = round2(balance * (apr / 1200));
    const interestPart = Math.min(payment, interest);
    const principal = Math.min(balance, round2(payment - interestPart));
    return { interest: round2(interestPart), principal, newBalance: round2(Math.max(0, balance - principal)) };
  }

  /** Standard amortising-loan payment (for suggesting a minimum). */
  function loanPayment(principal, apr, years) {
    const n = years * 12, r = apr / 1200;
    if (!n) return 0;
    return round2(r === 0 ? principal / n : (principal * r) / (1 - Math.pow(1 + r, -n)));
  }

  /* ---------- Subscriptions / recurring charges ---------- */

  const CADENCES = {
    weekly: { label: 'Weekly', perMonth: 52 / 12, days: 7 },
    monthly: { label: 'Monthly', perMonth: 1, days: 31 },
    quarterly: { label: 'Quarterly', perMonth: 1 / 3, days: 92 },
    yearly: { label: 'Yearly', perMonth: 1 / 12, days: 366 },
  };
  const dayNum = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
  const fromDayNum = (n) => { const d = new Date(n * 864e5); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
  const daysBetween = (a, b) => dayNum(b) - dayNum(a);
  const addDays = (iso, n) => fromDayNum(dayNum(iso) + n);
  function addMonthsClamped(iso, n) {
    const [, , d] = iso.split('-').map(Number);
    const ym = addMonths(iso.slice(0, 7), n), [yy, mm] = ym.split('-').map(Number);
    return `${ym}-${pad(Math.min(d, new Date(Date.UTC(yy, mm, 0)).getUTCDate()))}`;
  }
  /** The k-th charge date of a series anchored at `base` (k = 0 is the base itself). Computed from the anchor so month-ends don't drift. */
  function nthCharge(base, cadence, k) {
    return cadence === 'weekly' ? addDays(base, 7 * k) : addMonthsClamped(base, k * (cadence === 'monthly' ? 1 : cadence === 'quarterly' ? 3 : 12));
  }
  /** First charge date in the series that is on or after `from`. */
  function nextCharge(base, cadence, from) {
    for (let k = 0; k < 5000; k++) { const d = nthCharge(base, cadence, k); if (d >= from) return d; }
    return base;
  }
  /** All charge dates in [from, to]. */
  function chargesBetween(base, cadence, from, to) {
    const out = [];
    for (let k = 0; k < 5000; k++) { const d = nthCharge(base, cadence, k); if (d > to) break; if (d >= from) out.push(d); }
    return out;
  }
  const monthlyCost = (amount, cadence) => round2(amount * (CADENCES[cadence] || CADENCES.monthly).perMonth);

  // Categories that are normally variable spending or non-subscription flows; recurring detection ignores them.
  const NOT_SUBSCRIPTIONS = new Set(['Transfer', 'Income', 'Housing', 'Debt Payments', 'Savings', 'Groceries', 'Dining', 'Transport', 'Travel']);

  function median(a) { const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function cadenceForGap(g, n) {
    if (g >= 5 && g <= 9 && n >= 3) return 'weekly';
    if (g >= 26 && g <= 35) return 'monthly';
    if (g >= 80 && g <= 100) return 'quarterly';
    if (g >= 340 && g <= 390) return 'yearly';
    return null;
  }

  /**
   * Find charges that repeat at a steady interval for a similar amount.
   * Returns [{key, name, amount, cadence, count, lastDate, nextDate, monthlyCost, category, active}].
   */
  function detectRecurring(txns, today) {
    const groups = {};
    for (const t of txns) {
      if (t.amount >= 0 || NOT_SUBSCRIPTIONS.has(t.category)) continue;
      const key = merchantKey(t.desc);
      if (key.length < 3) continue;
      (groups[key] ||= []).push(t);
    }
    const found = [];
    for (const [key, list] of Object.entries(groups)) {
      if (list.length < 2) continue;
      // keep the most common amount cluster (within 10% or $1), so a one-off different charge doesn't hide the pattern
      let best = [];
      for (const t of list) {
        const tol = Math.max(1, Math.abs(t.amount) * 0.1);
        const near = list.filter((o) => Math.abs(Math.abs(o.amount) - Math.abs(t.amount)) <= tol);
        if (near.length > best.length) best = near;
      }
      if (best.length < 2) continue;
      // two charges is thin evidence: only accept it when the amounts are essentially identical (like a real subscription)
      if (best.length === 2 && Math.abs(Math.abs(best[0].amount) - Math.abs(best[1].amount)) > Math.max(0.5, Math.abs(best[0].amount) * 0.01)) continue;
      best.sort((a, b) => a.date.localeCompare(b.date));
      const dates = [...new Set(best.map((t) => t.date))];
      if (dates.length < 2) continue;
      const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d));
      const med = median(gaps), cadence = cadenceForGap(med, dates.length);
      if (!cadence) continue;
      const steady = gaps.filter((g) => Math.abs(g - med) <= Math.max(4, med * 0.2)).length / gaps.length;
      if (steady < 0.6) continue;
      const last = best[best.length - 1], lastDate = dates[dates.length - 1];
      const amount = round2(Math.abs(last.amount));
      const active = daysBetween(lastDate, today) <= CADENCES[cadence].days * 1.6;
      found.push({
        key, name: last.desc, amount, cadence, count: dates.length, lastDate, category: last.category, active,
        nextDate: active ? nextCharge(lastDate, cadence, today > lastDate ? today : addDays(lastDate, 1)) : null,
        monthlyCost: monthlyCost(amount, cadence),
      });
    }
    return found.sort((a, b) => b.monthlyCost - a.monthlyCost);
  }

  return {
    parseCSV, detectColumns, parseAmount, parseDate, categorize, merchantKey, rowsToTransactions, txnKey,
    CADENCES, detectRecurring, nextCharge, chargesBetween, monthlyCost, daysBetween, addDays,
    CATEGORIES, monthOf, addMonths, monthlyReport, payoffPlan, splitPayment, loanPayment, round2,
  };
});
