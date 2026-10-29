# Wheel Tracker user guide

Wheel Tracker reads the account activity CSVs you export from Robinhood and shows the **true cost basis** of stocks you trade with the wheel strategy. It also covers wheel cycles, premium analytics, an option analyzer, a roll planner, multi-leg strategies, alerts, several accounts and Excel export.

Your trade data stays on your computer. The only thing sent over the internet is ticker symbols, to fetch quotes from Yahoo Finance.

**Contents**
1. [Install](#1-install)
2. [Get your Robinhood report](#2-get-your-robinhood-report)
3. [Load reports and set up accounts](#3-load-reports-and-set-up-accounts)
4. [Starting cash and opening balances](#4-starting-cash-and-opening-balances)
5. [The dashboard](#5-the-dashboard)
6. [Positions and true cost basis](#6-positions-and-true-cost-basis)
7. [Open options and the option analyzer](#7-open-options-and-the-option-analyzer)
8. [Roll planner](#8-roll-planner)
9. [Combine positions (multi-leg strategies)](#9-combine-positions-multi-leg-strategies)
10. [Add trades by hand](#10-add-trades-by-hand)
11. [Cycles, Analytics, Other options and No shares held](#11-cycles-analytics-other-options-and-no-shares-held)
12. [Alerts](#12-alerts)
13. [Settings](#13-settings)
14. [Export to Excel or CSV](#14-export-to-excel-or-csv)
15. [Updates](#15-updates)
16. [FAQ](#16-faq)

---

## 1. Install

1. Download **`WheelTracker-Setup-<version>.exe`** from the [latest release](https://github.com/the2ndlead/wheel-tracker/releases/latest).
2. Run it. The app isn't code-signed, so Windows may say **"Windows protected your PC"**. Click **More info → Run anyway**.
3. Pick an install folder. You don't need admin rights. The installer adds Desktop and Start-menu shortcuts.

To uninstall, go to **Settings → Apps → Wheel Tracker**.

## 2. Get your Robinhood report

1. On **robinhood.com** go to **Account → Reports and statements → Reports**.
2. Generate an **account activity** report. Cover your **entire account history** if you can, because the app needs your older trades to work out cost basis.
3. Download the CSV.

Repeat for each account (e.g. Roth IRA and Individual). Later, download a fresh report whenever you want to catch up. It's fine if new reports overlap old ones.

## 3. Load reports and set up accounts

Save your CSVs in **`Documents\Wheel Tracker\reports`**, with **one sub-folder per account**:

```
Documents\Wheel Tracker\reports\
  Roth IRA\     roth-ira-report-01012026-10282026.csv
  Individual\   individual-01012026-10282026.csv
```

- Each sub-folder becomes an **account** named after the folder. The app picks up new files on launch and whenever a file changes, so you don't need to restart it.
- With two or more accounts, the app opens on **All accounts (combined)**. Switch accounts with the menu next to the title. **Manage accounts…** there renames or deletes accounts.
- **Reports ▾** (in the header) lists the CSVs in the current account's folder. Tick several to **merge** them; rows that appear in more than one file are counted once. **Open folder** opens the folder in Explorer.
- On an account with nothing loaded yet, you can also drag CSVs onto the drop area or click it to choose files.
- To replace an old report, save the newer one in the same folder and delete the old file.

## 4. Starting cash and opening balances

If your report doesn't start when the account was opened, the app can't see your starting cash, or shares and options you held before the report starts.

- **Starting cash**: the app estimates it and shows a blue banner. Click **Set exact amount** and enter the cash balance Robinhood shows today. The app works backwards from it.
- **Opening balances** (header button, single account only): enter an **as of** date, starting cash, **stock positions** (ticker, shares, cost per share) and **open short options** (sold before the report starts, with the credit received). Import notes that say *"fixable with opening balances"* go away once you add the missing positions.

## 5. The dashboard

The cards at the top:

| Card | Meaning |
|---|---|
| **Account value** | Cash + stock at market + long options at market − cost to buy back open short options |
| **Cash** | Includes how much is set aside for cash-secured puts |
| **Stock value** | Shares at today's price, with the market value of long and short options shown below |
| **Total gain** | Account value minus deposits and opening balances |
| **Unrealized vs true basis** | Gain or loss on open stock positions, measured from true cost basis |
| **Wheel premium** | All short put and call premium, net of buybacks, with this month's total |

Below the cards are **Alerts** (section 12) and **import notes**: things the app couldn't fully match, like a sale of shares bought before the report starts.

Use **Refresh prices** to reload quotes, and **☀︎ / ☾** to switch between light and dark.

## 6. Positions and true cost basis

**True cost basis** = (what you paid for the shares − premium collected) ÷ shares.

*Example:* you're assigned 100 XYZ at $50 ($5,000) after collecting $150 on the put, then sell a covered call for $80. True basis = ($5,000 − $150 − $80) ÷ 100 = **$47.70**, while Robinhood shows $50.00.

The **Positions** tab shows each stock you hold with:
- price, market value, broker average cost, true cost basis;
- P/L vs true basis and vs average cost;
- premium collected and any open options.

- **Realized only / Include open contracts** (above the table) decides whether premium from options that are still open lowers your basis now (*Include open*), or only once they expire, are assigned or are bought back (*Realized only*, the default).
- **Click a true cost basis** to open **"What lowered my basis?"**. It lists every premium, buyback and dividend that went into it, with a running total.
- **Click a row** for the position detail:
  - basis, average cost and price;
  - put and call premium, realized stock P/L, dividends, total return;
  - a **cost basis over time** chart;
  - every transaction for that stock (trades you entered by hand have a **Manual** badge).
- **set price**: if a quote is missing or wrong, click the price and type your own. **manual** marks prices you entered.

## 7. Open options and the option analyzer

The **Open options** tab lists every open contract:
- strike, expiry, days left (DTE), stock price, premium, value now and P/L;
- **max profit captured** (how much of a short option's premium you've already earned);
- collateral for puts.

**ITM** marks contracts that are in the money.

Click a row (or **Analyze →**) to open the **option analyzer** for that contract:

- **Contract value now**, **unrealized P/L**, **max profit captured**, **max risk used**
- **Max profit**, **max risk**, **breakeven**, **days to expiry**, implied volatility
- **Expected P/L** and **probability of profit**. These are model estimates from implied volatility, not forecasts.
- A **P/L at expiry** chart. For a covered call it also shows shares + call measured from your true basis.
- **Set price** overrides the option's price if the quote is missing. **Plan a roll…** opens the roll planner.

## 8. Roll planner

Click **Roll…** on a short put or covered call (Open options tab), or **Plan a roll…** in the analyzer.

1. **Buy back the current contract**
   - **Roll date**: today, or an earlier date if you're recording a roll you already made.
   - **Price / share**: what you pay to buy it back, **per share** as Robinhood shows it ($0.95 = $95 a contract).
   - **Fees**, if any.
2. **Sell the new contract**: pick the **expiration** and **strike** from the live option chain. **Premium / share** fills in from the bid/ask midpoint, and you can change it. Set **contracts** and **fees**.

Both prices are **per share for each leg, not the net credit**. Robinhood shows a roll as one net number. If it says *"credit $1.83"*, you need the two legs. For example, buy back at **0.95** and sell the new one at **2.78**: (2.78 − 0.95) × 100 = **$183**. The **Net credit** tile should then read **+$183.00**. If you don't know the leg prices, open the two orders in Robinhood's history.

The planner shows:
- **net credit or debit**, **time added**, **strike change** and the **annualized** return;
- a table comparing **Close now / Keep current / Roll**: cash today, option P/L, P/L at today's price, breakeven, chance of profit;
- your **true cost basis**: right after the trade, if the put is assigned, if the call expires, and if the shares are called away;
- a P/L chart of keeping vs rolling.

Nothing is saved until you click **I made this roll, record it**. That adds a buy to close and a sell to open to the account's manual trades. When the roll later shows up in a Robinhood report, delete the manual entries; the app flags them as duplicates.

## 9. Combine positions (multi-leg strategies)

Use this to see the **total** risk and return of several positions on one ticker. Examples:
- two short puts that pay for a long call;
- shares plus a covered call;
- a spread.

Click **Combine positions…** above the Open options table, or **Combine…** on a row. Pick the ticker and **tick the positions** that make up the strategy. If you hold shares, they're a leg too, measured from your true cost basis.

*Example:* XYZ at $90. Sell 2× $80 puts for $20.00 each (+$4,000) and buy 1× $100 call for $32.00 (−$3,200), same expiry:

| | |
|---|---|
| Net credit at open | +$800 |
| Max profit | Unlimited (the long call) |
| Max loss | $15,200, if XYZ goes to $0 (2 × $8,000 − $800) |
| Breakeven | $76.00 ($80 − $800 ÷ 200 shares) |
| Cash to secure puts | $16,000 |

You also get:
- **P/L now** (at today's prices);
- **Acts like N shares** (net delta: what a $1 move in the stock does to your P/L today);
- the model's **chance of profit** and expected P/L;
- a table of P/L at expiry if the stock moves −50% to +50%;
- a chart of P/L at expiry next to the **Today (model)** value.

If the legs expire on different dates, results are shown at the **first** expiry. Options that expire later are valued at that date with an option-pricing estimate.

## 10. Add trades by hand

Use this for fills that aren't in your report yet, or for an account that has no report.

1. Pick the account (not *All accounts*), then click **+ Add trade** in the header. Once you've added trades, the button reads **Manual trades (n)**. An empty account also has an **Enter your trades by hand** link.
2. Choose **What happened**:
   - **Options**: sell to open, buy to close, buy to open, sell to close, expired, assigned, exercised.
   - **Shares**: buy, sell.
   - **Cash**: dividend, deposit, withdrawal.
3. For closes, expirations and assignments, **Fill in from an open contract** copies the ticker, type, strike, expiration and contracts for you.
4. Enter the **date**, **ticker**, **type** (put/call), **strike**, **expiration**, **contracts**, **premium per share** ($1.25 = $125 a contract) and **fees**. The **cash effect** line shows the total before you save.
5. Click **Add trade**. Use **Edit** or **Delete** in the list below the form to change it later.

Manual trades count exactly like imported ones. An assigned or exercised option also records the share purchase or sale at the strike. When a newer report includes the same trade, the app warns that it's counted twice; delete the manual one.

## 11. Cycles, Analytics, Other options and No shares held

- **Cycles**: each wheel cycle on a ticker, from the first put or share purchase until you hold no shares and no open options. It shows dates, days, premium, stock P/L, dividends, total return, capital used, return and annualized return. Totals at the top cover closed and open cycles and how many were profitable.
- **Analytics**:
  - win rate, annualized yield, average days held, assignment rate;
  - cumulative premium, premium by month (against your monthly goal), and net premium by ticker;
  - a table of every closed short option.
- **Other options**: long calls and puts (not part of the wheel), with realized and unrealized P/L and win rate. When you exercise a long option, its premium is added to the cost of the shares, not counted as wheel premium.
- **No shares held**: tickers you've fully exited, with their results.

## 12. Alerts

Alerts at the top of the dashboard warn you when:
- a short put or call is **in the money** (assignment risk);
- an option **expires within 7 days**, or its expiry has passed but it still shows as open (import a newer report);
- a **covered call strike is below your true cost basis** (being called away would lock in a loss);
- a short option has reached **50% or 80% of max profit** (consider closing);
- you **don't have enough cash** to cover your puts;
- a stock is **down more than X%** from your true cost basis (X is set in Settings).

Click **Analyze** on an alert to open the contract.

## 13. Settings

Open with the **⚙** button. Settings are per account; *All accounts* has its own.

- **True cost basis**:
  - **All premium on the ticker** or **Current cycle only**;
  - **Subtract dividends too**;
  - **Include realized long-option P/L**;
  - **Realized only** (same as the toggle on the Positions tab).
- **Monthly premium goal**: shown on the Analytics tab.
- **Alert when down vs true basis (%)**.
- **Automatically load new CSVs** saved to the account's folder.
- **Version and updates**: the installed version, plus a **Check for updates** button.

## 14. Export to Excel or CSV

**Export ▾** → **Excel workbook** saves one file with sheets for positions, open options, cycles, trades, other options and every transaction. Or export any single table as a **CSV**.

## 15. Updates

The installed Windows app checks for a new version **each time it starts** and every 6 hours while open. It downloads updates in the background, then shows **Update ready** in the header. Click it and choose **Restart & update**. If you don't, the update installs the next time you close the app. Your reports, manual trades and settings are kept.

## 16. FAQ

**My basis or cash looks wrong.** Your report probably doesn't go back far enough. Download one covering your entire history, or add **opening balances** (section 4). Check the import notes for clues.

**An option still shows as open but it expired.** Load a newer report, or record it with **+ Add trade → Expired**.

**A price or option quote is missing.** Yahoo may not have it (e.g. outside market hours). Click **set price** or **Set price** and type it in.

**Does my data go anywhere?** No. CSVs and everything you enter stay on your PC. Only ticker symbols are sent to Yahoo Finance for quotes.

**Is this financial advice?** No. Probabilities and expected P/L are model estimates based on implied volatility. Check numbers against your broker before trading.
