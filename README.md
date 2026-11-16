# Budget IO

A personal budgeting app that runs entirely in your browser – no account, no server, no build step.

## Features

- **CSV upload** – drop in a bank or credit-card export. Budget IO auto-detects the date, description, amount (or separate debit/credit) columns, lets you correct them in a preview, guesses categories, and skips duplicates if you re-import overlapping statements. Re-categorise a transaction once and it remembers that merchant.
- **Savings buckets** – set a goal, deposit and withdraw, and watch a jar fill with cash (with falling bills on every deposit and confetti when you hit 100%). Add a monthly contribution to see your projected finish date.
- **Monthly reports** – pick any month for income, spending, net and savings rate; a category donut and breakdown with change vs. last month; a 6‑month income/spending trend; biggest expenses; optional per-category budgets with over-budget warnings. Export the report to CSV or print it.
- **Debt payoff** – track mortgages, student loans, car loans, credit cards and more, each with its own interest rate and minimum payment. See payoff dates and lifetime interest, compare **avalanche** (highest rate first), **snowball** (smallest balance first) and minimums-only, add an "extra per month" amount, and log payments that are split into interest and principal.
- **Private** – data is stored in your browser's `localStorage`. Use *Back up data* / *Restore backup* to move it between browsers.

## Run it

Open `index.html` in a browser – that's it. Or serve the folder:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

Click **Load sample data** on the dashboard for a demo, or upload `samples/sample-transactions.csv`.

## Tests

The CSV, report and debt maths live in `js/core.js` and are covered by plain Node tests (no dependencies):

```sh
node tests/core.test.js
```

## Layout

```
index.html        app shell
css/styles.css    styling (light/dark, responsive, print)
js/core.js        pure logic: CSV parsing, categorising, reports, payoff simulation
js/app.js         UI, state and localStorage
samples/          example bank CSV
tests/            unit tests for core.js
```

## Notes

- Debt interest is modelled monthly at APR ÷ 12. For a mortgage, enter principal & interest only (not escrow).
- Transfers are excluded from income and spending so moving money between accounts doesn't skew reports.
