import { useCallback, useEffect, useMemo, useState } from 'react';
import { mergeCsvFiles, type CsvFile } from './parser/merge';
import type { ManualTrade } from './parser/manual';
import { EMPTY_MERGE, buildFromSources, ownerOf, type AccountSource } from './lib/sources';
import { estimateOpeningCash } from './engine/ledger';
import { buildAlerts } from './engine/alerts';
import { fetchOptionQuotes, fetchQuotes, type OptionQuote, type Quote } from './prices/yahoo';
import { load, save } from './lib/storage';
import { formatDate, usd as usdFmt } from './lib/format';
import {
  ALL_ID,
  deleteAccountData,
  importKey,
  loadAccounts,
  manualKey,
  loadAllAccount,
  marksKey,
  pricesKey,
  saveAccounts,
  saveAllAccount,
  type Account,
  type StoredImport,
} from './lib/accounts';
import { listFolders, listReports, onReportsChanged, onUpdateStatus, readReport, type UpdateStatus } from './lib/platform';
import { syncAccountsWithFolders } from './lib/folderSync';
import { buildOptionRows, buildPositionRows } from './lib/rows';
import { buildSheets, exportCsv, exportWorkbook, type SheetName } from './lib/export';
import { ImportPanel } from './components/ImportPanel';
import { SummaryCards, type Summary } from './components/SummaryCards';
import { PositionsTable } from './components/PositionsTable';
import { ClosedTable } from './components/ClosedTable';
import { OpenOptionsTable } from './components/OpenOptionsTable';
import { PositionDetail } from './components/PositionDetail';
import { WarningsPanel } from './components/WarningsPanel';
import { AccountSwitcher } from './components/AccountSwitcher';
import { OpeningBalancesDialog, type OpeningPrefill } from './components/OpeningBalancesDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { AlertsPanel } from './components/AlertsPanel';
import { OptionAnalyzer } from './components/OptionAnalyzer';
import { StrategyAnalyzer } from './components/StrategyAnalyzer';
import { CyclesTable } from './components/CyclesTable';
import { AnalyticsTab } from './components/AnalyticsTab';
import { OtherOptionsTab } from './components/OtherOptionsTab';
import { ExportMenu } from './components/ExportMenu';
import { Toast, type ToastMessage } from './components/Toast';
import { BasisBreakdown } from './components/BasisBreakdown';
import { ManualTradesDialog } from './components/ManualTradesDialog';
import { RollPlanner } from './components/RollPlanner';
import type { BasisOptions } from './engine/types';

function WheelIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden className="text-sky-500">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.2" />
      {[0, 60, 120].map((a) => (
        <line key={a} x1="12" y1="3.5" x2="12" y2="20.5" stroke="currentColor" strokeWidth="1.6" transform={`rotate(${a} 12 12)`} />
      ))}
      <circle cx="12" cy="12" r="2.6" className="fill-emerald-400" />
    </svg>
  );
}

type Tab = 'positions' | 'options' | 'cycles' | 'analytics' | 'other' | 'closed';

const dayBefore = (iso: string) => new Date(Date.parse(iso) - 86_400_000).toISOString().slice(0, 10);

export default function App() {
  const [{ accounts, activeId }, setAccountState] = useState(loadAccounts);
  const [allAccount, setAllAccount] = useState(loadAllAccount);
  // "All accounts" is a virtual account: every account's trades combined, with its own settings.
  const isAll = activeId === ALL_ID;
  const account = isAll ? allAccount : accounts.find((a) => a.id === activeId) ?? accounts[0];

  const [imported, setImported] = useState<StoredImport | null>(() => load<StoredImport | null>(importKey(account.id), null));
  const [manualPrices, setManualPrices] = useState<Record<string, number>>(() => load(pricesKey(account.id), {}));
  const [manualMarks, setManualMarks] = useState<Record<string, number>>(() => load(marksKey(account.id), {}));
  const [manualTrades, setManualTrades] = useState<ManualTrade[]>(() => load(manualKey(account.id), []));
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [optionQuotes, setOptionQuotes] = useState<Record<string, OptionQuote>>({});
  const [quoteErrors, setQuoteErrors] = useState<Record<string, string>>({});
  const [loadingQuotes, setLoadingQuotes] = useState(false);

  const [selected, setSelected] = useState<string | null>(null);
  const [analyzeKey, setAnalyzeKey] = useState<string | null>(null);
  const [rollKey, setRollKey] = useState<string | null>(null);
  const [strategyTicker, setStrategyTicker] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('positions');
  const [opening, setOpening] = useState<OpeningPrefill | true | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tradesOpen, setTradesOpen] = useState(false);
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' });
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [reportsVersion, setReportsVersion] = useState(0);
  /** Bumped when another account's stored import changes (the combined view reads them all). */
  const [importsVersion, setImportsVersion] = useState(0);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    save('wt.theme', dark ? 'dark' : 'light');
  }, [dark]);

  useEffect(() => onUpdateStatus(setUpdate), []);

  // Each sub-folder of the reports folder is an account: create/attach accounts for new
  // folders, load their CSVs, and drop files that were loaded into the wrong account.
  const syncFolders = useCallback(async () => {
    try {
      const [folders, root] = await Promise.all([listFolders(), listReports('')]);
      const current = loadAccounts();
      const imports = Object.fromEntries(current.accounts.map((a) => [a.id, load<StoredImport | null>(importKey(a.id), null)?.files.map((f) => f.name)]));
      const withManual = current.accounts.filter((a) => load<ManualTrade[]>(manualKey(a.id), []).length).map((a) => a.id);
      const r = syncAccountsWithFolders(current.accounts, folders, root.map((f) => f.name), imports, withManual);
      const unchanged =
        !r.created.length && !r.removed.length && !Object.keys(r.load).length && !Object.keys(r.drop).length && JSON.stringify(r.accounts) === JSON.stringify(current.accounts);
      if (unchanged) return;

      for (const [id, names] of Object.entries(r.drop)) {
        const imp = load<StoredImport | null>(importKey(id), null);
        if (imp) save(importKey(id), { ...imp, files: imp.files.filter((f) => !names.includes(f.name)) });
      }
      for (const [id, names] of Object.entries(r.load)) {
        const folder = r.accounts.find((a) => a.id === id)!.folder;
        const files = await Promise.all(names.map(async (name) => ({ name, text: await readReport(folder, name) })));
        save(importKey(id), { files, loadedAt: new Date().toISOString() } satisfies StoredImport);
      }
      r.removed.forEach(deleteAccountData);

      let active = current.activeId;
      if (r.removed.includes(active) || (r.created.length && r.accounts.length > 1)) active = r.accounts.length > 1 ? ALL_ID : r.accounts[0].id;
      saveAccounts(r.accounts, active);
      setAccountState({ accounts: r.accounts, activeId: active });
      setImported(load<StoredImport | null>(importKey(active), null));
      setManualPrices(load(pricesKey(active), {}));
      setManualMarks(load(marksKey(active), {}));
      setManualTrades(load(manualKey(active), []));
      setImportsVersion((v) => v + 1);
      if (r.created.length) {
        const names = r.accounts.filter((a) => r.created.includes(a.id)).map((a) => a.name);
        setToast({ id: Date.now(), text: `Set up ${names.join(' and ')} from your reports folders.` });
      }
    } catch {
      /* folders unavailable (e.g. production build in a plain browser) */
    }
  }, []);

  useEffect(() => {
    syncFolders();
  }, [syncFolders]);

  // ---------- Accounts ----------
  const setAccounts = (next: Account[], nextActive = activeId) => {
    saveAccounts(next, nextActive);
    setAccountState({ accounts: next, activeId: nextActive });
  };
  const patchAccount = (patch: Partial<Account>) => {
    if (isAll) {
      const next = { ...allAccount, ...patch };
      setAllAccount(next);
      saveAllAccount(next);
    } else setAccounts(accounts.map((a) => (a.id === account.id ? { ...a, ...patch } : a)));
  };
  const switchAccount = (id: string) => {
    setAccounts(accounts, id);
    setImported(load<StoredImport | null>(importKey(id), null));
    setManualPrices(load(pricesKey(id), {}));
    setManualMarks(load(marksKey(id), {}));
    setManualTrades(load(manualKey(id), []));
    setSelected(null);
    setAnalyzeKey(null);
    setRollKey(null);
    setBreakdown(null);
  };
  const deleteAccount = (id: string) => {
    deleteAccountData(id);
    const rest = accounts.filter((a) => a.id !== id);
    if (id === activeId || (isAll && rest.length < 2)) {
      setAccounts(rest, rest[0].id);
      switchAccount(rest[0].id);
    } else setAccounts(rest);
  };

  const notify = (text: string) => setToast({ id: Date.now(), text });

  const saveManualTrades = (next: ManualTrade[]) => {
    setManualTrades(next);
    save(manualKey(account.id), next.length ? next : undefined);
  };

  // ---------- Import ----------
  const storeImport = useCallback(
    (files: CsvFile[]) => {
      const next = { files, loadedAt: new Date().toISOString() };
      setImported(next);
      save(importKey(account.id), next);
      setSelected(null);
    },
    [account.id],
  );

  const combinedCount = useMemo(
    () =>
      isAll
        ? accounts.filter((a) => load<StoredImport | null>(importKey(a.id), null)?.files.length || load<ManualTrade[]>(manualKey(a.id), []).length).length
        : 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAll, accounts, importsVersion],
  );

  // What the portfolio is built from: this account's files + manual trades, or every account's.
  const { sources, error } = useMemo((): { sources: AccountSource[]; error: string | null } => {
    try {
      if (isAll) {
        const list = accounts.map((a) => {
          const imp = load<StoredImport | null>(importKey(a.id), null);
          return { id: a.id, name: a.name, csv: imp?.files.length ? mergeCsvFiles(imp.files) : EMPTY_MERGE, manual: load<ManualTrade[]>(manualKey(a.id), []), opening: a.opening };
        });
        return { sources: list, error: null };
      }
      const csv = imported?.files.length ? mergeCsvFiles(imported.files) : EMPTY_MERGE;
      return { sources: [{ id: account.id, name: account.name, csv, manual: manualTrades, opening: account.opening }], error: null };
    } catch (e) {
      return { sources: [], error: e instanceof Error ? e.message : String(e) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAll, accounts, imported, manualTrades, account.id, account.name, account.opening, importsVersion]);

  const built = useMemo(() => {
    try {
      return buildFromSources(sources, isAll, account.basis);
    } catch {
      return null;
    }
  }, [sources, isAll, account.basis]);
  const portfolio = built?.portfolio ?? null;
  const transactions = built?.transactions ?? null;

  // Auto-load CSVs that appear in this account's reports folder.
  useEffect(
    () =>
      onReportsChanged(async () => {
        setReportsVersion((v) => v + 1);
        await syncFolders();
        if (isAll || !account.autoLoad) return;
        try {
          const since = imported?.loadedAt ?? '';
          const known = new Set(imported?.files.map((f) => f.name));
          const fresh = (await listReports(account.folder)).filter((f) => !known.has(f.name) || f.modified > since);
          if (!fresh.length) return;
          const added = await Promise.all(fresh.map(async (f) => ({ name: f.name, text: await readReport(account.folder, f.name) })));
          const names = new Set(added.map((f) => f.name));
          storeImport([...(imported?.files ?? []).filter((f) => !names.has(f.name)), ...added]);
          notify(`Loaded ${added.map((f) => f.name).join(', ')}`);
        } catch (e) {
          notify(`Couldn't auto-load: ${e instanceof Error ? e.message : String(e)}`);
        }
      }),
    [isAll, account.autoLoad, account.folder, imported, storeImport, syncFolders],
  );

  // ---------- Prices ----------
  const quoteTickers = useMemo(() => {
    if (!portfolio) return [];
    const set = new Set(portfolio.tickers.filter((t) => t.shares > 0).map((t) => t.ticker));
    portfolio.openOptions.forEach((o) => set.add(o.underlying));
    return [...set];
  }, [portfolio]);

  const refreshQuotes = useCallback(
    async (force = false) => {
      if (!portfolio || !quoteTickers.length) return;
      setLoadingQuotes(true);
      const live = portfolio.openOptions.filter((o) => o.expiry >= new Date().toISOString().slice(0, 10));
      const [stock, opts] = await Promise.all([fetchQuotes(quoteTickers, force), fetchOptionQuotes(live, force)]);
      setQuotes((prev) => ({ ...prev, ...stock.quotes }));
      setOptionQuotes((prev) => ({ ...prev, ...opts.quotes }));
      setQuoteErrors(stock.errors);
      setLoadingQuotes(false);
    },
    [portfolio, quoteTickers],
  );

  useEffect(() => {
    refreshQuotes();
  }, [refreshQuotes]);

  const setManual = (setter: typeof setManualPrices, key: string) => (k: string, v: number | null) =>
    setter((prev) => {
      const next = { ...prev };
      if (v == null) delete next[k];
      else next[k] = v;
      save(key, next);
      return next;
    });
  const onOverridePrice = setManual(setManualPrices, pricesKey(account.id));
  const onSetMark = setManual(setManualMarks, marksKey(account.id));

  // ---------- Derived ----------
  const rows = useMemo(() => (portfolio ? buildPositionRows(portfolio, quotes, manualPrices) : []), [portfolio, quotes, manualPrices]);
  const optionRows = useMemo(
    () => (portfolio ? buildOptionRows(portfolio, quotes, manualPrices, optionQuotes, manualMarks) : []),
    [portfolio, quotes, manualPrices, optionQuotes, manualMarks],
  );

  const alerts = useMemo(() => {
    if (!portfolio) return [];
    const prices: Record<string, number | null> = {};
    quoteTickers.forEach((t) => (prices[t] = manualPrices[t] ?? quotes[t]?.price ?? null));
    const marks = Object.fromEntries(optionRows.map((o) => [o.key, o.mark]));
    const dte = Object.fromEntries(optionRows.map((o) => [o.key, o.dte]));
    return buildAlerts({ portfolio, prices, marks, dte: (o) => dte[o.key] ?? 0, dropThreshold: account.dropThreshold });
  }, [portfolio, quoteTickers, manualPrices, quotes, optionRows, account.dropThreshold]);

  const summary: Summary | null = useMemo(() => {
    if (!portfolio) return null;
    const stockValue = rows.reduce((s, r) => s + (r.marketValue ?? r.costRaw), 0);
    const longOptionsValue = optionRows.filter((o) => o.side === 'long').reduce((s, o) => s + (o.analysis.contractValue ?? o.analysis.premium), 0);
    const shortOptionsLiability = optionRows
      .filter((o) => o.side === 'short' && o.dte >= 0)
      .reduce((s, o) => s + (o.analysis.contractValue ?? o.analysis.premium), 0);
    const accountValue = portfolio.cash + stockValue + longOptionsValue - shortOptionsLiability;
    const thisMonth = new Date().toISOString().slice(0, 7);
    return {
      accountValue,
      cash: portfolio.cash,
      cspCollateral: portfolio.openOptions.filter((o) => o.side === 'short' && o.type === 'Put').reduce((s, o) => s + o.strike * 100 * o.contracts, 0),
      stockValue,
      longOptionsValue,
      shortOptionsLiability,
      netDeposits: portfolio.netDeposits,
      openingCapital: portfolio.openingCapital,
      openingCash: portfolio.openingCash,
      openingCashEstimated: portfolio.openingCashEstimated,
      totalGain: accountValue - portfolio.netDeposits,
      unrealizedTrue: rows.reduce((s, r) => s + (r.plTrue ?? 0), 0),
      totalPremium: portfolio.totalPremium,
      premiumThisMonth: portfolio.premiumByMonth.find((m) => m.month === thisMonth)?.premium ?? 0,
      missingPrices: rows.filter((r) => r.price == null).length,
      missingMarks: optionRows.filter((o) => o.mark == null && o.dte >= 0).length,
    };
  }, [portfolio, rows, optionRows]);

  const closed = portfolio?.tickers.filter((t) => t.shares === 0) ?? [];
  const selectedPosition = portfolio?.tickers.find((t) => t.ticker === selected);
  const analyzeRow = optionRows.find((o) => o.key === analyzeKey);
  const rollRow = optionRows.find((o) => o.key === rollKey);
  const rollOwner = rollRow ? ownerOf(sources, isAll, rollRow.key) : undefined;
  const simulateRoll = useCallback(
    (trades: ManualTrade[], basis: BasisOptions) => {
      if (!rollOwner) return null;
      try {
        return buildFromSources(sources, isAll, basis, { accountId: rollOwner.id, trades })?.portfolio ?? null;
      } catch {
        return null;
      }
    },
    [sources, isAll, rollOwner],
  );
  const recordRoll = (trades: ManualTrade[]) => {
    if (!rollOwner) return;
    if (!isAll && rollOwner.id === account.id) saveManualTrades([...manualTrades, ...trades]);
    else {
      save(manualKey(rollOwner.id), [...load<ManualTrade[]>(manualKey(rollOwner.id), []), ...trades]);
      setImportsVersion((v) => v + 1);
    }
    setRollKey(null);
    setAnalyzeKey(null);
    notify(`Recorded the roll in ${rollOwner.name}'s manual trades. Delete them there once your next export includes them.`);
  };
  const quoteErrorList = Object.keys(quoteErrors).filter((t) => manualPrices[t] == null);
  const unrealizedByTicker = Object.fromEntries(rows.map((r) => [r.ticker, r.plBroker]));
  const firstDate = transactions?.[0]?.date ?? null;

  const b = account.basis;
  const basisLabel =
    [b.scope === 'all' ? 'all premium' : 'current cycle', b.includeDividends && 'dividends', b.includeLongOptions && 'long options'].filter(Boolean).join(' + ') +
    (b.realizedOnly ? ' · realized' : ' · incl. open');
  const openPremium = rows.reduce((s, r) => s + r.openPremium, 0);
  const breakdownPosition = portfolio?.tickers.find((t) => t.ticker === breakdown);

  const exportName = (ext: string) => `wheel-tracker-${account.name.replace(/\W+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.${ext}`;
  const sheets = () => buildSheets(portfolio!, rows, optionRows);

  const tabs: [Tab, string][] = portfolio
    ? [
        ['positions', `Positions (${rows.length})`],
        ['options', `Open options (${portfolio.openOptions.length})`],
        ['cycles', `Cycles (${portfolio.cycles.length})`],
        ['analytics', 'Analytics'],
        ['other', `Other options (${portfolio.longTrades.length})`],
        ['closed', `No shares held (${closed.length})`],
      ]
    : [];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-zinc-200 bg-zinc-50/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight">
                <WheelIcon />
                Wheel Tracker
              </h1>
              {isAll && portfolio && (
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  {combinedCount} accounts combined · {portfolio.transactionCount} rows
                  {portfolio.firstDate && ` · ${formatDate(portfolio.firstDate)} – ${formatDate(portfolio.lastDate!)}`}
                </div>
              )}
              {!isAll && portfolio && (
                <div className="max-w-[22rem] truncate text-xs text-zinc-500 dark:text-zinc-400" title={imported?.files.map((f) => f.name).join(', ')}>
                  {imported?.files.length ? `${imported.files.length === 1 ? imported.files[0].name : `${imported.files.length} files merged`} · ` : ''}
                  {manualTrades.length > 0 && `${manualTrades.length} manual · `}
                  {portfolio.transactionCount} rows
                  {portfolio.firstDate && ` · ${formatDate(portfolio.firstDate)} – ${formatDate(portfolio.lastDate!)}`}
                </div>
              )}
            </div>
            <AccountSwitcher accounts={accounts} activeId={account.id} onSwitch={switchAccount} onChange={(next) => setAccounts(next)} onDelete={deleteAccount} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {update.state === 'ready' && (
              <button className="btn-primary" onClick={() => setSettingsOpen(true)}>
                Update ready
              </button>
            )}
            {!isAll && (imported || manualTrades.length > 0) && (
              <ImportPanel folder={account.folder} loaded={imported?.files.map((f) => f.name) ?? []} onLoad={storeImport} refreshKey={reportsVersion} compact />
            )}
            {!isAll && (imported || manualTrades.length > 0) && (
              <button className="btn" onClick={() => setTradesOpen(true)} title="Add trades by hand">
                {manualTrades.length ? `Manual trades (${manualTrades.length})` : '+ Add trade'}
              </button>
            )}
            {portfolio && (
              <>
                {!isAll && (
                  <button className="btn" onClick={() => setOpening(true)}>
                    Opening balances
                  </button>
                )}
                <button className="btn" onClick={() => refreshQuotes(true)} disabled={loadingQuotes}>
                  {loadingQuotes ? 'Updating…' : 'Refresh prices'}
                </button>
                <ExportMenu
                  onExcel={() => exportWorkbook(sheets(), exportName('xlsx'))}
                  onCsv={(s: SheetName) => exportCsv(sheets()[s], exportName(`${s.toLowerCase().replace(/\s+/g, '-')}.csv`))}
                />
              </>
            )}
            <button className="btn" onClick={() => setSettingsOpen(true)} title="Settings">
              ⚙
            </button>
            {!isAll && imported && (
              <button
                className="btn"
                onClick={() => {
                  if (!window.confirm(`Remove the imported data for "${account.name}" from this app? CSV files on disk are kept.`)) return;
                  setImported(null);
                  save(importKey(account.id), undefined);
                }}
              >
                Clear
              </button>
            )}
            <button className="btn" onClick={() => setDark(!dark)} title="Toggle theme">
              {dark ? '☀︎' : '☾'}
            </button>
          </div>
        </div>
      </header>

      <main className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        {!isAll && !imported && !manualTrades.length && (
          <>
            <ImportPanel folder={account.folder} loaded={[]} onLoad={storeImport} refreshKey={reportsVersion} />
            <div className="text-center text-sm text-zinc-500 dark:text-zinc-400">
              No export yet?{' '}
              <button className="font-medium text-sky-600 hover:underline dark:text-sky-400" onClick={() => setTradesOpen(true)}>
                Enter your trades by hand
              </button>
            </div>
          </>
        )}
        {isAll && !portfolio && !error && (
          <div className="card p-6 text-center text-sm text-zinc-500">None of your accounts has imported data yet. Switch to an account and load a report first.</div>
        )}

        {error && (
          <div className="card border-rose-300 p-4 text-sm text-rose-700 dark:border-rose-500/40 dark:text-rose-300">Couldn't read the import: {error}</div>
        )}

        {portfolio && summary && (
          <>
            <SummaryCards s={summary} onOpening={isAll ? undefined : () => setOpening(true)} combined={isAll} />

            {quoteErrorList.length > 0 && (
              <div className="text-sm text-amber-700 dark:text-amber-400">
                Couldn't fetch prices for {quoteErrorList.join(', ')}. Click a price to enter it manually.
              </div>
            )}
            <AlertsPanel alerts={alerts} onOpenOption={setAnalyzeKey} />
            <WarningsPanel warnings={portfolio.warnings} onFix={isAll ? undefined : setOpening} />

            <div>
              <div className="mb-3 flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
                {tabs.map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
                      tab === key
                        ? 'border-sky-500 text-zinc-900 dark:text-zinc-100'
                        : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {tab === 'positions' && (
                <>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="inline-flex rounded-lg border border-zinc-300 p-0.5 text-sm dark:border-zinc-700" role="radiogroup" aria-label="Premium counted toward cost basis">
                      {(
                        [
                          [true, 'Realized only'],
                          [false, 'Include open contracts'],
                        ] as const
                      ).map(([v, text]) => (
                        <button
                          key={text}
                          role="radio"
                          aria-checked={b.realizedOnly === v}
                          onClick={() => patchAccount({ basis: { ...b, realizedOnly: v } })}
                          className={`rounded-md px-3 py-1 font-medium ${
                            b.realizedOnly === v ? 'bg-sky-600 text-white' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white'
                          }`}
                        >
                          {text}
                        </button>
                      ))}
                    </div>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {b.realizedOnly
                        ? openPremium > 0.005
                          ? `${usdFmt(openPremium)} of premium from open contracts isn't counted until they close.`
                          : 'Only premium from closed contracts lowers the basis.'
                        : 'Premium counts as soon as it is received, even if the contract is still open.'}{' '}
                      Click a true cost basis to see which trades lowered it.
                    </span>
                  </div>
                  <PositionsTable rows={rows} basisLabel={basisLabel} onSelect={setSelected} onOverridePrice={onOverridePrice} onBasisClick={setBreakdown} />
                </>
              )}
              {tab === 'options' && <OpenOptionsTable rows={optionRows} onAnalyze={setAnalyzeKey} onRoll={setRollKey} onCombine={setStrategyTicker} />}
              {tab === 'cycles' && <CyclesTable cycles={portfolio.cycles} tickers={portfolio.tickers} unrealized={unrealizedByTicker} />}
              {tab === 'analytics' && <AnalyticsTab portfolio={portfolio} monthlyGoal={account.monthlyGoal} dark={dark} />}
              {tab === 'other' && <OtherOptionsTab trades={portfolio.longTrades} exercises={portfolio.exercises} openRows={optionRows} onAnalyze={setAnalyzeKey} />}
              {tab === 'closed' && <ClosedTable rows={closed} onSelect={setSelected} />}
            </div>

            <p className="text-xs text-zinc-500 dark:text-zinc-500">
              True cost basis = (cost of shares held − {basisLabel}) ÷ shares. Exercised long-option premium is part of share cost, never wheel
              premium. Expected P/L figures are model estimates from implied volatility.
            </p>
          </>
        )}
      </main>

      {selectedPosition && (
        <PositionDetail
          position={selectedPosition}
          row={rows.find((r) => r.ticker === selected)}
          dark={dark}
          showAccount={isAll}
          onBreakdown={() => setBreakdown(selectedPosition.ticker)}
          onClose={() => setSelected(null)}
        />
      )}
      {breakdownPosition && <BasisBreakdown position={breakdownPosition} basis={b} onClose={() => setBreakdown(null)} />}
      {analyzeRow && !rollRow && (
        <OptionAnalyzer row={analyzeRow} dark={dark} onClose={() => setAnalyzeKey(null)} onSetMark={onSetMark} onRoll={() => setRollKey(analyzeRow.key)} />
      )}
      {strategyTicker && portfolio && (
        <StrategyAnalyzer
          ticker={strategyTicker}
          optionRows={optionRows}
          tickers={portfolio.tickers}
          positionRows={rows}
          premiumInBasis={!portfolio.basis.realizedOnly}
          dark={dark}
          onClose={() => setStrategyTicker(null)}
        />
      )}
      {rollRow && rollOwner && (
        <RollPlanner
          row={rollRow}
          dark={dark}
          basis={account.basis}
          accountName={rollOwner.name}
          simulate={simulateRoll}
          onRecord={recordRoll}
          onClose={() => setRollKey(null)}
        />
      )}
      {opening && !isAll && (
        <OpeningBalancesDialog
          value={account.opening}
          defaultAsOf={firstDate ? dayBefore(firstDate) : null}
          prefill={opening === true ? null : opening}
          estimatedCash={transactions ? estimateOpeningCash(transactions) : 0}
          fileCash={portfolio?.fileCash ?? 0}
          onSave={(v) => patchAccount({ opening: v })}
          onClose={() => setOpening(null)}
        />
      )}
      {tradesOpen && !isAll && (
        <ManualTradesDialog
          trades={manualTrades}
          openOptions={portfolio?.openOptions ?? []}
          tickers={portfolio?.tickers.map((t) => t.ticker).sort() ?? []}
          onSave={saveManualTrades}
          onClose={() => setTradesOpen(false)}
        />
      )}
      {settingsOpen && <SettingsDialog account={account} update={update} onChange={patchAccount} onClose={() => setSettingsOpen(false)} />}
      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}
