# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A client-side app (Windows desktop via Electron, or browser via the Vite dev server) that imports Robinhood account activity CSVs and calculates the **true cost basis** of stocks traded with the wheel strategy. It also covers wheel cycles, premium analytics, an option analyzer, alerts, multiple accounts, opening balances, Excel export and auto-update.

## Commands

```bash
npm install          # first time
npm run dev          # http://localhost:5173 (reports API + Yahoo endpoints live here)
npm test             # vitest, run once
npm run build        # tsc --noEmit && vite build
npm run app          # vite build + open in Electron (reads repo reports/)
npm run dist:win     # build + NSIS installer → release/WheelTracker-Setup-<version>.exe
npm run release:win  # build + publish to github.com/the2ndlead/wheel-tracker (this repo) (needs GH_TOKEN)
npm run dist:mac     # Apple Silicon DMG → release/ (macOS only; electron-builder refuses on Windows)
```

- Mac: `build-resources/after-pack.cjs` ad-hoc signs the .app (`codesign --sign -`), which arm64 macOS requires because there's no Developer ID. Auto-update is Windows-only (`electron/main.cjs` returns early on non-win32), and Settings tells Mac users to `git pull` + `npm run dist:mac`. Icon must stay ≥ 512px (it's 1024).
- `.github/workflows/build.yml` builds both installers on GitHub runners (manual run or `v*` tag) with `--publish never` and uploads them as artifacts.

## Two runtimes, one UI

- **Browser / dev server**: `vite.config.ts` serves `/api/reports`, `/api/chart`, `/api/options` and pushes `wt:reports-changed` over the HMR socket.
- **Desktop**: `electron/main.cjs` does the same over IPC. `electron/preload.cjs` exposes it as `window.wheelDesktop`. It also handles folder watching and electron-updater. The packaged reports folder is `Documents\Wheel Tracker\reports`.
- Both use **`electron/core.cjs`**: the reports folder, Yahoo quotes, and the Yahoo option chain (cookie + crumb handshake). Types are in `core.d.cts`. `vite.config.ts` loads it with `createRequire`, because Vite bundles its config as ESM.
- UI code never fetches `/api/*` directly. It goes through `src/lib/platform.ts`.
- The folder watcher is skipped when `VITEST` is set; an open watcher keeps vitest and vite-node running. Use `VITEST=1 npx vite-node script.ts` for one-off scripts.
- `base: './'` so `dist/index.html` loads from `file://`. `index.html` has a CSP: keep scripts local.
- UI libraries live in `devDependencies` because Vite bundles them. `electron-updater` is the one runtime `dependency`; it must ship in the app.
- If Electron starts as plain Node, the shell has `ELECTRON_RUN_AS_NODE=1` set (VS Code sets it). Unset it before `npm run app` or launching the exe.
- electron-builder without Developer Mode fails extracting winCodeSign. The fix is in the README.

## Layout

```
src/
  parser/robinhood.ts    CSV text → Transaction[] (oldest first)
  parser/merge.ts        Several CSVs → one Transaction[] (dedup rule below)
  engine/types.ts        All shared types, DEFAULT_BASIS, EMPTY_OPENING
  engine/ledger.ts       Transaction[] + EngineOptions → Portfolio (basis, cycles, short/long trades, exercises)
  engine/options.ts      Payoff, max profit/risk, Black–Scholes, implied vol, lognormal expectation
  engine/alerts.ts       Portfolio + live prices → Alert[]
  engine/*.test.ts       Tests (fixtures/sample.csv, sample-2.csv, inline CSVs)
  prices/yahoo.ts        Quotes + option-chain marks with a 60s cache
  lib/platform.ts        Desktop IPC vs dev-server fetch
  lib/accounts.ts        Accounts in localStorage; migrates v0.1 keys (wt.csv, wt.prices)
  lib/rows.ts            PositionRow / OptionRow: engine output + live prices
  lib/export.ts          SheetJS workbook / CSV
  components/            UI. Modal.tsx has Modal/Field/inputClass. chartTheme.ts has chart colors.
  App.tsx                Accounts, import, quotes, derived summary, tabs, dialogs
electron/                main.cjs, preload.cjs, core.cjs (+ core.d.cts)
build-resources/icon.png App/installer icon
reports/                 User CSVs (git-ignored); account sub-folders inside
fixtures/                Synthetic CSVs, the only CSVs committed
release/                 electron-builder output (git-ignored)
```

## Domain rules

- CSV columns: `Activity Date, Process Date, Settle Date, Instrument, Description, Trans Code, Quantity, Price, Amount`. Newest-first, disclaimer footer, multi-line stock descriptions, `($1,234.56)` negatives, quantity suffixes like `1S`. Use `Amount` for cash (net of fees).
- Option descriptions (`AAPL 1/19/2024 Put $150.00`) are matched anywhere in the string.
- Codes: `Buy`/`Sell`; `STO`/`BTC` → **wheel premium**; `BTO`/`STC` → long options (`otherOptionsPL`); `OEXP`, `OASGN`, `OEXCS`; `CDIV` dividends; deposits `ACH`, `CFRI` (IRA conversion), `DRFRO` (rollover); income `INT`, `SLIP`, `MTCH` (IRA match); splits `SPL`/`SPR`. Unknown codes → other cash + warning.
- **True basis = (costRaw − basisReduction) / shares.** `basisReduction` = Σ `basisItems[].counted`. Every STO/BTC (counted part), dividend and long-option P/L event becomes a `BasisItem`; `countBasisItems` applies `BasisOptions`: scope (all / current cycle), dividends, long options, and **`realizedOnly`** (default true, chosen by the user). With `realizedOnly`, an STO's `openAmount` (the share still tied to open contracts, shrunk proportionally in `closeShort` like `reduceOpen`) isn't counted. `runningReduction` gives the same number during replay for the history chart; a test checks they agree.
- The "What lowered my basis?" window (`components/BasisBreakdown.tsx`) renders `basisItems`, so any rule change shows up there automatically.
- With `realizedOnly`, an open covered call's premium is **not** in `trueCostBasis`. `analyzeOption` gets `premiumInBasis` and the CC-below-basis alert adds the premium per share, so payoff and alerts don't double-count or omit it.
- **All accounts (combined)**: virtual account `ALL_ID` ('__all') with its own settings in `wt.all.settings`. `buildCombinedPortfolio` runs `buildPortfolio` **per account**, then sums positions per ticker (cost, shares, basis reduction; basis items, cycles and trades tagged with `source`). Trades are never pooled across accounts, because pooling would let one account's round trip change another's average cost (a test covers this). Histories are merged share-weighted; positions record a 0-share point when closed so the merge stops counting them. Opening balances and imports are edited per account, never in the combined view.
- **Manual trades** (`parser/manual.ts`, stored per account under `wt.<id>.manual`): each `ManualTrade` converts to the same `Transaction` rows a CSV would give (`manual: true`), so the engine never special-cases them. Assigned/exercised entries also emit their stock leg at the strike, so `reconcileAssignments` matches it instead of inferring one. `withManualTrades` appends them after imported rows of the same day. It warns (but still counts) when one matches an imported row. Folder sync never removes an account that has manual trades (`keep` param).
- **Portfolio sources** (`lib/sources.ts`): App parses each account once into an `AccountSource` (CSV merge + manual trades + opening), and `buildFromSources` builds single or combined. The roll planner calls it with `extra` trades for the owning account (`ownerOf`: combined option keys start with `<account name>:`) to simulate the cost basis. Nothing is saved until the user records the roll.
- **Roll math** (`lib/roll.ts`): option P/L is measured from when the current contract was sold, so keep vs roll compare on the same footing. "If assigned / expires" basis rows add a `settleTrade` dated at expiry and use realized mode. Called-away gain = (strike − basis with all premium) × shares covered.
- **Strategy view** (`engine/strategy.ts`, `components/StrategyAnalyzer.tsx`): selected legs of one ticker are evaluated at the first expiry; later expiries use Black–Scholes with their IV (or the contract-weighted average). Unlimited profit/loss comes from the slope past the last strike (shares + long calls − short calls). Shares are measured from the true basis; in include-open mode the open short premium is added back to it, so the option legs' premium isn't counted twice.
- **Accounts from folders** (`lib/folderSync.ts`, run on launch and on every reports-folder change): each sub-folder of the reports folder that holds CSVs is an account named after it. An existing account with that folder, or with that name and the main folder, is reused; otherwise one is created. The main-folder account is removed once the main folder is empty and its imports all live in sub-folders. Accounts with nothing imported load their folder's CSVs. Files imported into the wrong account (present in another account's folder) are dropped. After creating accounts, the app switches to the combined view.
- In the combined view, `OpenOption.key` is prefixed with the account name, so option quotes and caches must always be keyed by `contractKey(o)`, never `o.key`.
- Share transfers: `ITRF`/`ACATO` rows with an instrument and no cash move shares **out** at average cost (counted as a withdrawal) if the account holds them, otherwise **in** at $0 cost. `REC` = shares received at $0 cost. Cash `ITRF` rows are deposits/withdrawals. Leftovers under `SHARE_DUST` (0.001 shares) after a sale count as fully sold.
- **Long option exercise**: premium paid goes into share cost (call) or reduces proceeds (put). It's recorded as an `ExerciseEvent`. It is not in `otherOptionsPL` and never in wheel premium. The user chose this.
- `reconcileAssignments` pairs each `OASGN`/`OEXCS` with its stock row (qty = contracts × 100, price = strike, ±5 days) or infers one. It moves the stock leg **directly before** the assignment row and tags it `assignmentLeg`, so cycles don't close early and capital isn't double-counted.
- **Cycles**: open on a short put or share buy while no cycle is open. Close when shares = 0 and no short options are open. Cycles without premium or assignments are filtered out (plain stock trades).
- **Merge dedup**: key = date|code|instrument|description|qty|price|amount. Keep the max count of a key in any single file, not the sum, so real identical fills survive.
- **Starting cash**: `opening.cash = null` means "estimate". The estimate is the lowest *end-of-day* running cash balance, negated (cash/IRA accounts can't go below $0), computed after `reconcileAssignments` so inferred legs count. An entered number, even 0, overrides it. `Portfolio.openingCashEstimated` drives the UI banner. The "match Robinhood" helper sets starting cash = today's cash − `fileCash`.
- **History before the export**: a BTC with no matching open contract, and an STC with no matching long, count in cash but are left out of wheel premium / options P/L (partial matches are prorated), with a warning. Same idea as sells of shares with unknown cost.
- **Opening balances** become synthetic rows dated `asOf` (default: day before the first row). Cash → `OPENCASH`. Positions → `Buy` with `noCash`. Short options → `STO` with `noCash`. Opening cash and position cost count toward `netDeposits`/`openingCapital`. Opening premium counts toward wheel premium but not `premiumByMonth`.
- Account value (UI) = cash + stock at market + long options at mark − short options at mark (cost if no quote). IV is solved from the mark (`impliedVol`), falling back to Yahoo's IV.

## Conventions

- Keep `parser/` and `engine/` pure (no React, DOM or fetch). Add tests for rule changes and hand-compute the expected numbers.
- **Never commit real trade data.** `*.csv` is git-ignored except `fixtures/`. Don't read `reports/` in tests.
- Only ticker symbols leave the machine (Yahoo requests).
- Dark-first UI: every color needs a `dark:` variant. Charts use `chartTheme.ts`, one axis, and `isAnimationActive={false}` on lines.
- The sticky header has `backdrop-blur`, which makes it the containing block for `position: fixed` children. Pop-ups opened from the header must portal to `<body>`: `Modal` does this. Dropdowns close via `lib/useClickAway`, never a full-screen `fixed` backdrop.
- localStorage goes through `lib/storage.ts`. Keys: `wt.accounts`, `wt.activeAccount`, `wt.<accountId>.import|prices|marks`, `wt.theme`.
- To check the UI without a browser, load `dist/` in a hidden Electron window and use `capturePage()`.
- Commit on feature branches, not `main`.
