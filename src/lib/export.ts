import * as XLSX from 'xlsx';
import type { Portfolio } from '../engine/types';
import type { OptionRow, PositionRow } from './rows';

type Row = Record<string, string | number | null>;
export type SheetName = 'Positions' | 'Open options' | 'Cycles' | 'Short trades' | 'Other options' | 'Transactions';

const r2 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);
const r4 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10000) / 10000);

export function buildSheets(p: Portfolio, positions: PositionRow[], options: OptionRow[]): Record<SheetName, Row[]> {
  return {
    Positions: positions.map((r) => ({
      Ticker: r.ticker,
      Shares: r.shares,
      Price: r2(r.price),
      'Market value': r2(r.marketValue),
      'Avg cost': r2(r.avgCost),
      'True cost basis': r2(r.trueCostBasis),
      'P/L vs true basis': r2(r.plTrue),
      'P/L vs true basis %': r4(r.plTruePct),
      'P/L vs avg cost': r2(r.plBroker),
      'Wheel premium': r2(r.wheelPremium),
      'Put premium': r2(r.putPremium),
      'Call premium': r2(r.callPremium),
      Dividends: r2(r.dividends),
      'Realized stock P/L': r2(r.realizedStock),
    })),
    'Open options': options.map((o) => ({
      Ticker: o.underlying,
      Side: o.side,
      Type: o.type,
      Strike: o.strike,
      Expiry: o.expiry,
      DTE: o.dte,
      Contracts: o.contracts,
      Premium: r2(o.analysis.premium),
      'Mark / share': r2(o.mark),
      'Value now': r2(o.analysis.contractValue),
      'Unrealized P/L': r2(o.analysis.unrealizedPL),
      'Max profit captured %': r4(o.analysis.maxProfitCaptured),
      'Max profit': r2(o.analysis.maxProfit),
      'Max risk': r2(o.analysis.maxRisk),
      Breakeven: r2(o.analysis.breakeven),
      'Expected P/L (model)': r2(o.analysis.expectedPL),
      'Prob. of profit (model)': r4(o.analysis.probProfit),
      IV: r4(o.iv),
    })),
    Cycles: p.cycles.map((c) => ({
      Ticker: c.ticker,
      Cycle: c.index,
      Status: c.status,
      Start: c.start,
      End: c.end,
      Days: c.days,
      Premium: r2(c.premium),
      'Stock P/L (realized)': r2(c.stockPL),
      Dividends: r2(c.dividends),
      'Total return (realized)': r2(c.totalReturn),
      Capital: r2(c.capital),
      'Return %': r4(c.returnPct),
      'Annualized %': r4(c.annualizedPct),
      Assignments: c.assignments,
      'Called away': c.calledAway,
    })),
    'Short trades': p.shortTrades.map((t) => ({
      Ticker: t.ticker,
      Type: t.type,
      Strike: t.strike,
      Expiry: t.expiry,
      Opened: t.opened,
      Closed: t.closed,
      Days: t.days,
      Contracts: t.contracts,
      Outcome: t.outcome,
      'Net premium': r2(t.netPremium),
      Collateral: r2(t.collateral),
      'Annualized yield': r4(t.annualizedYield),
    })),
    'Other options': p.longTrades.map((t) => ({
      Ticker: t.ticker,
      Type: t.type,
      Strike: t.strike,
      Expiry: t.expiry,
      Opened: t.opened,
      Closed: t.closed,
      Contracts: t.contracts,
      Outcome: t.outcome,
      Cost: r2(t.cost),
      Proceeds: r2(t.proceeds),
      'P/L': r2(t.pl),
    })),
    Transactions: p.tickers
      .flatMap((t) => t.transactions)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
      .map((t) => ({
        Date: t.date,
        Code: t.code,
        Instrument: t.instrument,
        Description: t.description.split('\n')[0],
        Quantity: t.quantity,
        Price: r2(t.price),
        Amount: r2(t.amount),
        Note: t.synthetic ? 'inferred/opening' : t.manual ? `manual entry${t.source && t.source !== 'Manual entry' ? ` (${t.source})` : ''}` : t.source ?? '',
      })),
  };
}

export function exportWorkbook(sheets: Record<SheetName, Row[]>, fileName: string) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ '(empty)': '' }]);
    ws['!cols'] = Object.keys(rows[0] ?? {}).map((k) => ({ wch: Math.max(10, k.length + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  XLSX.writeFile(wb, fileName);
}

export function exportCsv(rows: Row[], fileName: string) {
  const csv = XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(rows));
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
