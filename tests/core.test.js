const assert = require('assert');
const C = require('../js/core.js');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('parseCSV quotes, embedded comma/newline, BOM', () => {
  const rows = C.parseCSV('﻿Date,Desc,Amount\r\n2026-01-02,"Cafe, Inc ""X""",-4.50\n2026-01-03,"multi\nline",10\n');
  assert.deepStrictEqual(rows[1], ['2026-01-02', 'Cafe, Inc "X"', '-4.50']);
  assert.strictEqual(rows[2][1], 'multi\nline');
  assert.strictEqual(rows.length, 3);
});
t('parseCSV semicolon & tab delimiters', () => {
  assert.deepStrictEqual(C.parseCSV('a;b;c\n1;2;3')[1], ['1', '2', '3']);
  assert.deepStrictEqual(C.parseCSV('a\tb\n1\t2')[1], ['1', '2']);
});
t('parseAmount formats', () => {
  assert.strictEqual(C.parseAmount('$1,234.56'), 1234.56);
  assert.strictEqual(C.parseAmount('(12.00)'), -12);
  assert.strictEqual(C.parseAmount('-7.25'), -7.25);
  assert.strictEqual(C.parseAmount('12.00-'), -12);
  assert.strictEqual(C.parseAmount('45.00 DR'), -45);
  assert.strictEqual(C.parseAmount('1.234,56'), 1234.56);
  assert.ok(isNaN(C.parseAmount('abc')));
  assert.ok(isNaN(C.parseAmount('')));
});
t('parseDate formats', () => {
  assert.strictEqual(C.parseDate('2026-03-09T10:00:00'), '2026-03-09');
  assert.strictEqual(C.parseDate('3/9/2026'), '2026-03-09');
  assert.strictEqual(C.parseDate('3/9/26'), '2026-03-09');
  assert.strictEqual(C.parseDate('13/02/2026', 'dmy'), '2026-02-13');
  assert.strictEqual(C.parseDate('13/02/2026'), '2026-02-13'); // forgiving swap
  assert.strictEqual(C.parseDate('Nov 3, 2026'), '2026-11-03');
  assert.strictEqual(C.parseDate('3 Nov 2026'), '2026-11-03');
  assert.strictEqual(C.parseDate('2026-02-31'), null);
  assert.strictEqual(C.parseDate('junk'), null);
});
t('detectColumns', () => {
  const m = C.detectColumns(['Transaction Date', 'Description', 'Debit', 'Credit', 'Balance']);
  assert.deepStrictEqual([m.date, m.desc, m.debit, m.credit, m.amount], [0, 1, 2, 3, -1]);
  const m2 = C.detectColumns(['Date', 'Payee', 'Amount', 'Category']);
  assert.deepStrictEqual([m2.date, m2.desc, m2.amount, m2.category], [0, 1, 2, 3]);
});
t('rowsToTransactions with debit/credit + invert + skipped', () => {
  const rows = C.parseCSV('Date,Description,Debit,Credit\n2026-01-02,Starbucks,4.50,\n2026-01-03,Payroll,,2000\nbad,row,1,\n');
  const { txns, skipped } = C.rowsToTransactions(rows, C.detectColumns(rows[0]));
  assert.strictEqual(txns.length, 2);
  assert.deepStrictEqual([txns[0].amount, txns[0].category], [-4.5, 'Dining']);
  assert.deepStrictEqual([txns[1].amount, txns[1].category], [2000, 'Income']);
  assert.deepStrictEqual(skipped, [4]);
  const inv = C.rowsToTransactions(C.parseCSV('Date,Desc,Amount\n2026-01-02,Shell,40'), { date: 0, desc: 1, amount: 2, debit: -1, credit: -1, category: -1 }, { invert: true });
  assert.strictEqual(inv.txns[0].amount, -40);
});
t('categorize custom rules + income guard', () => {
  assert.strictEqual(C.categorize('Whole Foods #12', -50), 'Groceries');
  assert.strictEqual(C.categorize('Zelle from Bob', 50), 'Transfer');
  assert.strictEqual(C.categorize('Random Shop', -5), 'Other');
  assert.strictEqual(C.categorize('Random Shop', 5), 'Income');
  assert.strictEqual(C.categorize('Joes Place', -9, { joes: 'Dining' }), 'Dining');
});
t('monthlyReport', () => {
  const tx = [
    { date: '2026-02-01', desc: 'Pay', amount: 3000, category: 'Income' },
    { date: '2026-02-02', desc: 'Rent', amount: -1200, category: 'Housing' },
    { date: '2026-02-03', desc: 'Food', amount: -100, category: 'Groceries' },
    { date: '2026-02-04', desc: 'Refund', amount: 20, category: 'Groceries' },
    { date: '2026-02-05', desc: 'xfer', amount: -500, category: 'Transfer' },
    { date: '2026-03-01', desc: 'Other month', amount: -9, category: 'Dining' },
  ];
  const r = C.monthlyReport(tx, '2026-02');
  assert.strictEqual(r.income, 3000);
  assert.strictEqual(r.spending, 1280);
  assert.strictEqual(r.net, 1720);
  assert.strictEqual(r.categories[0].name, 'Housing');
  assert.strictEqual(r.categories.find((c) => c.name === 'Groceries').total, 80);
});
t('addMonths', () => {
  assert.strictEqual(C.addMonths('2026-01', -1), '2025-12');
  assert.strictEqual(C.addMonths('2026-11', 3), '2027-02');
});
t('payoffPlan matches amortisation formula', () => {
  const pmt = C.loanPayment(200000, 6, 30); // 1199.10
  assert.ok(Math.abs(pmt - 1199.1) < 0.01);
  const p = C.payoffPlan([{ id: 'm', balance: 200000, apr: 6, minPayment: pmt }]);
  assert.ok(Math.abs(p.months - 360) <= 1, 'months ' + p.months);
  assert.ok(Math.abs(p.totalInterest - 231676) < 400, 'interest ' + p.totalInterest);
});
t('payoffPlan extra payments save time and interest; avalanche <= snowball interest', () => {
  const debts = [
    { id: 'cc', balance: 5000, apr: 24, minPayment: 100 },
    { id: 'car', balance: 12000, apr: 6, minPayment: 250 },
    { id: 'sl', balance: 3000, apr: 4.5, minPayment: 50 },
  ];
  const base = C.payoffPlan(debts, { rollover: false });
  const av = C.payoffPlan(debts, { extra: 200, strategy: 'avalanche' });
  const sn = C.payoffPlan(debts, { extra: 200, strategy: 'snowball' });
  assert.ok(av.months < base.months && av.totalInterest < base.totalInterest);
  assert.ok(av.totalInterest <= sn.totalInterest + 0.01);
  assert.ok(sn.payoffMonth.sl < sn.payoffMonth.cc);
  assert.strictEqual(av.neverPaidOff.length, 0);
  assert.strictEqual(av.timeline[av.timeline.length - 1], 0);
});
t('payoffPlan detects never-paid-off', () => {
  const p = C.payoffPlan([{ id: 'x', balance: 10000, apr: 24, minPayment: 100 }]);
  assert.deepStrictEqual(p.neverPaidOff, ['x']);
});
t('splitPayment', () => {
  const s = C.splitPayment(100000, 6, 1000);
  assert.deepStrictEqual([s.interest, s.principal, s.newBalance], [500, 500, 99500]);
  const s2 = C.splitPayment(100, 12, 500);
  assert.strictEqual(s2.newBalance, 0);
});
t('detectRecurring finds monthly, weekly, yearly, ignores variable & one-off', () => {
  const tx = [];
  const add = (date, desc, amount, category = 'Subscriptions') => tx.push({ date, desc, amount, category });
  ['2026-08-03', '2026-09-03', '2026-10-03', '2026-11-03'].forEach((d) => { add(d, 'NETFLIX.COM 123', -15.49); add(d, 'Spotify USA', -10.99); });
  ['2026-08-05', '2026-09-09', '2026-10-04'].forEach((d, i) => add(d, 'City Electric', -[70, 120, 95][i], 'Utilities')); // variable
  ['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22'].forEach((d) => add(d, 'Meal Kit Co', -59, 'Shopping'));
  add('2025-11-10', 'Amazon Prime Membership', -139, 'Shopping'); add('2026-11-10', 'Amazon Prime Membership', -139, 'Shopping');
  add('2026-11-01', 'Rent - Maple', -1450, 'Housing'); add('2026-10-01', 'Rent - Maple', -1450, 'Housing');
  add('2026-09-09', 'Random Gadget', -49, 'Shopping');
  add('2026-10-03', 'Netflix Special', -4.99); // different amount, same merchant
  add('2026-09-22', 'CVS Pharmacy', -14.2, 'Health'); add('2026-10-22', 'CVS Pharmacy', -26.9, 'Health'); // two similar-ish monthly purchases
  const r = C.detectRecurring(tx, '2026-11-16');
  const by = Object.fromEntries(r.map((x) => [x.key, x]));
  assert.strictEqual(by['netflix com'].cadence, 'monthly');
  assert.strictEqual(by['netflix com'].amount, 15.49);
  assert.strictEqual(by['netflix com'].nextDate, '2026-12-03');
  assert.strictEqual(by['spotify usa'].count, 4);
  assert.strictEqual(by['meal kit'].cadence, 'weekly');
  assert.strictEqual(by['meal kit'].active, false); // last charge Oct 22, 25 days ago > 7*1.6
  assert.strictEqual(by['amazon prime'].cadence, 'yearly');
  assert.strictEqual(by['amazon prime'].nextDate, '2027-11-10');
  assert.strictEqual(by['amazon prime'].monthlyCost, 11.58);
  assert.ok(!by['city electric'], 'variable bill not a subscription');
  assert.ok(!by['rent maple'], 'housing excluded');
  assert.ok(!by['random gadget'], 'one-off ignored');
  assert.ok(!by['cvs pharmacy'], 'two different-amount charges are not enough');
  assert.strictEqual(C.categorize('CVS Pharmacy', -10), 'Health');
  assert.strictEqual(C.categorize("Macy's", -10), 'Shopping');
});
t('charge dates: next, between, month-end clamp, monthlyCost', () => {
  assert.strictEqual(C.nextCharge('2026-01-31', 'monthly', '2026-03-01'), '2026-03-31');
  assert.strictEqual(C.nextCharge('2026-01-31', 'monthly', '2026-02-10'), '2026-02-28');
  assert.deepStrictEqual(C.chargesBetween('2026-11-02', 'weekly', '2026-11-16', '2026-12-16'), ['2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14']);
  assert.strictEqual(C.nextCharge('2026-11-16', 'yearly', '2026-11-16'), '2026-11-16');
  assert.strictEqual(C.monthlyCost(120, 'yearly'), 10);
  assert.strictEqual(C.monthlyCost(12, 'weekly'), 52);
  assert.strictEqual(C.daysBetween('2026-02-28', '2026-03-01'), 1);
});
console.log(`\n${n} tests passed`);
