# Budget IO

A personal budgeting app that runs entirely in your browser – no account, no server, no build step.

## Features

- **CSV upload** – drop in a bank or credit-card export. Budget IO auto-detects the date, description, amount (or separate debit/credit) columns, lets you correct them in a preview, guesses categories, and skips duplicates if you re-import overlapping statements. Re-categorise a transaction once and it remembers that merchant.
- **Savings buckets** – set a goal, deposit and withdraw, and watch a jar fill with cash (with falling bills on every deposit and confetti when you hit 100%). Add a monthly contribution to see your projected finish date.
- **Monthly reports** – pick any month for income, spending, net and savings rate; a category donut and breakdown with change vs. last month; a 6‑month income/spending trend; biggest expenses; optional per-category budgets with over-budget warnings. Export the report to CSV or print it.
- **Subscriptions** – finds recurring charges (Netflix, gym, software…) in your imported transactions by looking for steady-interval, same-amount payments; add the ones you want to track, or add your own by hand. Shows monthly and yearly cost, what's due in the next 30 days, and how much you save by marking one cancelled. Rent, loan payments, groceries and other variable spending are never suggested.
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

## Security & privacy

- **No network access.** A Content-Security-Policy in `index.html` blocks every outgoing connection and any script that isn't one of the app's own files, and the app loads nothing from third parties. Your data cannot be sent anywhere.
- **Optional passphrase lock.** Use *Set passphrase* in the footer to encrypt everything stored in the browser (AES-256-GCM, key derived with PBKDF2, 310,000 iterations). The key is kept only in memory; the app re-locks after 10 idle minutes or when you tap *Lock now*. Backups are encrypted too. **There is no recovery if you forget the passphrase.** This also protects the data from other sites on the same `github.io` account, which share browser storage.
- **Passphrase strength meter.** Weak passphrases (like `password1`) are rejected; four random words is the recommended pattern.
- **Backup reminder.** A banner appears if you have data but no backup in the last 30 days (snooze for a week).
- **Delete-your-CSV reminder.** After each import you're prompted to delete the downloaded bank file from Downloads and any synced cloud folder.
- **Keep real data out of git.** `.gitignore` excludes `*.csv` (except the sample) and `budget-io-backup*.json`. Never commit bank exports or backups, especially to a public repo.
- **Protect the repo.** Anyone who can push to `main` controls the code that runs on your devices: enable two-factor authentication on your GitHub account and don't add collaborators you wouldn't trust with your finances.
- The passphrase lock needs HTTPS or `localhost` (or opening the file directly) because browsers only provide encryption APIs in secure contexts; GitHub Pages is HTTPS.

## Deploying to GitHub Pages

`.github/workflows/pages.yml` runs the tests and publishes only `index.html`, `css/` and `js/`. After merging to `main`, go to **Settings → Pages** and set **Source** to **GitHub Actions**. (Free GitHub accounts can only use Pages on public repositories.)

## Notes

- Debt interest is modelled monthly at APR ÷ 12. For a mortgage, enter principal & interest only (not escrow).
- Transfers are excluded from income and spending so moving money between accounts doesn't skew reports.
