# Wheel Tracker UI

A desktop app for **Windows** and **Mac (Apple Silicon)**, which also runs as a local web app, that reads your **Robinhood account activity CSV** and works out the **true cost basis** of every stock you hold while running the wheel strategy (cash-secured puts → assignment → covered calls).

Robinhood shows your average purchase price. It doesn't subtract the premium you collected selling puts before assignment, or the covered calls you sold afterwards. This app does.

## Features

**Portfolio**
- Account value with stocks *and* options at market prices, plus cash, CSP collateral, net deposits, total gain, and wheel premium (all time and this month)
- Positions: shares, live price, market value, broker average cost, **true cost basis**, P/L against both, premium collected, open CCs/CSPs
- Per-ticker detail: every trade, wheel cycles, and a chart of cost basis over time

**Options**
- Open options priced from Yahoo's option chain: value now, P/L, % of max profit captured, collateral
- **Option analyzer**: payoff-at-expiry chart (covered calls also show shares + call vs true basis), max profit, max risk, % of max risk used, breakeven, implied volatility, plus a model estimate of expected P/L and probability of profit
- **Roll planner**: on any open put or covered call, click **Roll…** (Open options tab, or **Plan a roll…** in the analyzer). Pick a new expiration and strike from the live option chain; the premium fills in from the bid/ask midpoint, and you can edit it. You see the net credit or debit, the time added, and an annualized return. A side-by-side table compares **close now**, **keep current** and **roll**: cash today, option P/L, breakeven, chance of profit, and your **true cost basis** after the trade, if the new contract expires, and if it's assigned or called away. A chart shows P/L at expiry for keeping vs rolling. **I made this roll, record it** saves the buy to close and sell to open as manual trades.
- **Combine positions**: on the Open options tab, click **Combine positions…** (or **Combine…** on a row) to analyze several positions on one ticker as one strategy, e.g. two short LEAP puts paying for a long call. Tick the legs (and shares, if you hold them) to see the net credit or debit, P/L now, max profit and max loss, breakevens, cash to secure the puts, net delta, the model's chance of profit, a stock-move table, and the payoff at the first expiry next to today's model value.
- **Manual trades**: add trades by hand, e.g. fills that aren't in your export yet, or a whole account with no export. Covers sell/buy to open or close, expired, assigned, exercised, share buys and sells, dividends, deposits and withdrawals. They count exactly like imported rows. Use **+ Add trade** / **Manual trades** in the header, or **Enter your trades by hand** on an empty account. A trade the export later includes is flagged so you can delete it.
- **Other options** tab for long calls/puts, kept separate from the wheel. Exercised long-call premium is added to the cost of the shares you receive.

**Wheel insights**
- **Cycles**: each CSP → assignment → covered calls → called-away run, with total return, capital, days, and annualized return
- **Analytics**: monthly premium vs a goal, cumulative premium, premium by ticker, win rate, annualized yield, assignment rate, and a table of every closed short option
- **Alerts**: options in the money, expiring within 7 days, covered calls below true basis, not enough cash for your puts, 50%+ of max profit captured, positions down more than X% vs true basis
- **Realized vs. include open**: one click switches between counting only premium from closed contracts (default) and also counting premium from puts/calls you're still in
- **What lowered my basis?** Click any true cost basis to see every premium, buyback and dividend that moved it, whether it's counted, and the running total
- **Basis method**: all premium, or the current cycle only; optionally subtract dividends and long-option P/L

**Data**
- **Multiple accounts, set up from folders**: put each account's CSVs in its own sub-folder of the reports folder (e.g. `reports/Roth IRA/`, `reports/Individual/`). The app creates an account per folder, named after it, and loads its files.
- **All accounts (combined)**: one view across every account, with one overall cost basis per stock
- **Merge several CSVs**: overlapping rows are removed, real duplicate fills are kept
- **Opening balances** for exports that don't start at the beginning of your account
- **Auto-load**: new CSVs saved to the reports folder load on their own
- **Export** to an Excel workbook or CSV
- **Auto-update** for the installed app
- Dark mode by default. Your data stays on your PC; the only network calls are Yahoo Finance quotes.

## Windows desktop app

### Installing (for you and friends)

1. Get `WheelTracker-Setup-<version>.exe`. Download it from the [releases page](https://github.com/the2ndlead/wheel-tracker/releases/latest), build it yourself (below), or have someone send it to you.
2. Run it. The app is not code-signed, so Windows SmartScreen may say "Windows protected your PC". Click **More info → Run anyway**.
3. Choose an install folder. The installer adds Desktop and Start-menu shortcuts. No admin rights needed.
4. Save your Robinhood CSVs into **`Documents\Wheel Tracker\reports`**, with **one sub-folder per account**:
   ```
   Documents\Wheel Tracker\reports\
     Roth IRA\     wheel-report-01012026-10212026.csv
     Individual\   individual-01012026-10212026.csv
   ```
   On launch, and whenever files change, the app creates an account for each folder and loads its CSVs. With two or more accounts it opens on **All accounts (combined)**. Switch between accounts with the menu next to the title. **Reports ▾ → Open folder** opens the current account's folder.

Imports, opening balances and manual prices are saved in the app on each PC. Uninstall from **Settings → Apps → Wheel Tracker**.

### Building the installer

```bash
npm install
npm run dist:win
```

Output goes to **`release/`** (git-ignored): `WheelTracker-Setup-<version>.exe` to share, and `win-unpacked/`, a copy that runs without installing.

> **First build failing with "Cannot create symbolic link"?** electron-builder's signing-tools archive contains macOS symlinks, which Windows can't create without Developer Mode or admin rights. Turn on Developer Mode, or pre-extract the archive without the macOS files:
> ```bash
> cd "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign"
> curl -LO https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z
> "<repo>\node_modules\7zip-bin\win\x64\7za.exe" x winCodeSign-2.6.0.7z -owinCodeSign-2.6.0 -xr!darwin
> ```

`npm run app` builds the UI and opens it in Electron without installing. In that mode it reads the repo's `reports/` folder.

### Publishing an update (auto-update)

Installed copies check this repo's [GitHub releases](https://github.com/the2ndlead/wheel-tracker/releases) on launch and every 6 hours. They download new versions in the background and offer **Restart & update**.

One-time setup: create a GitHub token with `repo` scope (a fine-grained token needs **Contents: read & write** on this repo), or log in with `gh auth login` and use `$env:GH_TOKEN = gh auth token`.

For each release:
1. Bump `version` in `package.json` (e.g. `0.2.0` → `0.2.1`).
2. Run:
   ```powershell
   $env:GH_TOKEN = "<your token>"
   npm run release:win
   ```
   This builds the installer and uploads it, with `latest.yml`, as a GitHub release. Installed apps pick it up automatically.

## Mac app (Apple Silicon: M1–M4)

macOS apps can only be packaged on a Mac, so you build it once on your MacBook. It takes about 5 minutes the first time. Afterwards, Wheel Tracker lives in Applications like any other app.

### One-time setup

1. **Install Apple's command-line tools** (they include `git`). Open **Terminal** (⌘-Space → "Terminal") and run:
   ```bash
   xcode-select --install
   ```
   Click **Install** in the window that pops up. If it says they're already installed, move on.
2. **Install Node.js LTS.** Download the **macOS Installer (.pkg)** from https://nodejs.org and run it. Then check:
   ```bash
   node -v   # should print v22 or newer
   ```
3. **(Optional) Install GitHub's CLI.** The repo is public, so plain `git clone` works; the CLI only helps if you contribute:
   ```bash
   # if you have Homebrew:  brew install gh      (otherwise download from https://cli.github.com)
   gh auth login            # choose GitHub.com → HTTPS → "Login with a web browser"
   ```
   Or add an SSH key to your GitHub account: https://docs.github.com/authentication/connecting-to-github-with-ssh

### Build and install

```bash
cd ~/Documents
git clone https://github.com/the2ndlead/wheel-tracker.git
cd wheel-tracker
npm install
npm run dist:mac
open release
```

`release/` now contains **`WheelTracker-<version>-mac-arm64.dmg`**. Double-click it and drag **Wheel Tracker** into **Applications**. Then open it from Launchpad or Spotlight.

- The first time it opens, macOS may ask to let Wheel Tracker access your **Documents** folder. Click **Allow**, because that's where your reports folder lives.
- Save your Robinhood CSVs in **`~/Documents/Wheel Tracker/reports`** (the app creates it). **Reports ▾ → Open folder** opens it in Finder.
- Your data from the Windows app doesn't carry over. Load your CSVs again and re-enter any opening balances.

### Updating on the Mac

```bash
cd ~/Documents/wheel-tracker
git pull
npm install
npm run dist:mac
```

Then open the new DMG and drag the app into Applications again, choosing **Replace**. Your imported data and settings are kept. Auto-update only works on Windows, because macOS requires a paid Apple developer certificate for it.

### Alternative: download a build from GitHub instead of building

The repo has a **Build installers** workflow. On GitHub, go to **Actions → Build installers → Run workflow**. After about 10 minutes, download `wheel-tracker-macos-14` from the run page, unzip it, and open the DMG. A downloaded app isn't from an identified developer, so macOS will block it the first time. Either right-click the app → **Open** → **Open**, or run:

```bash
xattr -cr "/Applications/Wheel Tracker.app"
```

### Run without installing

```bash
npm run app     # builds and opens the app straight from the repo (reads the repo's reports/ folder)
npm run dev     # or run it in your browser at http://localhost:5173
```

### If something goes wrong

| Problem | Fix |
|---|---|
| `"Wheel Tracker" is damaged and can't be opened` | Run `xattr -cr "/Applications/Wheel Tracker.app"`. This happens with downloaded builds; ones you built yourself don't need it. |
| `npm install` warns about install scripts not covered by `allowScripts` | Run `npm install-scripts approve esbuild electron`, then `npm install` again. |
| `codesign: command not found` during `npm run dist:mac` | Install the command-line tools (step 1). |
| `git clone` asks for a password | Use `gh auth login` (step 3). GitHub no longer accepts account passwords. |

## Running from source (browser)

Requires [Node.js](https://nodejs.org/) 18 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:5173. The dev server reads CSVs from [`reports/`](reports/) (account sub-folders inside it) and fetches Yahoo data server-side.

### Exporting from Robinhood

1. On robinhood.com go to **Account → Reports and statements → Reports**.
2. Generate an **account activity** report covering your **entire account history**.
3. Save the CSV into the reports folder, then load it from **Reports ▾**, or drag it onto the page.

If you can only export part of your history, the cash you started with isn't in the file:

- **Automatic estimate.** Cash and IRA accounts can't go below $0, so if your export's running balance does, the app assumes you started with at least that much. It shows a banner saying so.
- **Exact match.** Open **Opening balances** and enter the cash Robinhood shows today, and the app works out the exact starting cash. Or type the starting balance from that month's statement.
- **Unknown cost.** Sales of shares or long options bought before the export starts, and buybacks of options sold before it, count toward cash but not toward premium or P/L, because their cost or credit isn't in the file. Add them as opening positions to include them. The import notes have **Add opening shares/option** buttons.

## How cost basis is calculated

For each ticker, transactions are replayed oldest to newest:

| Figure | Definition |
|---|---|
| **Avg cost** | Broker-style average cost of the shares you hold now. Sells reduce cost at the average. |
| **Wheel premium** | Net cash from **every short put and short call** on the ticker: sell-to-open minus buy-to-close. Includes puts that expired without assignment. |
| **True cost basis / share** | `(cost of shares held − basis reduction) ÷ shares held`. By default the reduction is all wheel premium from **closed** contracts. In Settings ⚙ you can switch to the current cycle only, and add dividends and long-option P/L. |
| **Realized only / Include open** | *Realized only* (default): premium from a put or call counts once it expires, is assigned or is bought back. While a contract is still open, its premium isn't counted. *Include open*: premium counts as soon as it's received. Partly closed positions count the closed share. |
| **All accounts (combined)** | Every account's trades in one ledger. Shares of the same stock are pooled at average cost, so you get one overall basis. Starting cash is estimated or entered per account. |
| **Exercised long call** | The premium paid is added to the cost of the shares received. For a put, it comes off the sale proceeds. It is never wheel premium. |
| **Other options P/L** | Realized P/L on long options that were sold or expired. Not in basis by default. |
| **Wheel cycle** | Starts with a cash-secured put or a share purchase. Ends when you hold no shares and no short options. Capital = peak of share cost + put collateral. |
| **Account value** | `cash + stock at market + long options at market − cost to buy back short options`. Falls back to cost when there's no quote. |
| **Cash** | Starting cash (entered, or estimated so cash never goes below $0) + the sum of every `Amount` in the CSV(s). |
| **Expected P/L / probability of profit** | Lognormal model with zero drift, using volatility implied by the option's price. These are estimates, not forecasts. |

When Robinhood records an assignment (`OASGN`) or exercise (`OEXCS`) without a matching stock Buy/Sell row, the app infers the stock trade at the strike and flags it in the import notes.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server with the reports API and Yahoo endpoints |
| `npm test` | Unit tests (Vitest) |
| `npm run build` | Type-check and build for production |
| `npm run app` | Build and open the desktop app (unpackaged) |
| `npm run dist:win` | Build the Windows installer into `release/` |
| `npm run dist:mac` | Build the Mac (Apple Silicon) DMG into `release/` (on a Mac only) |
| `npm run release:win` | Build and publish an update to GitHub releases (needs `GH_TOKEN`) |

## Tech

React 18 · TypeScript · Vite · Tailwind CSS · Recharts · PapaParse · SheetJS · Vitest · Electron · electron-builder (NSIS) · electron-updater
