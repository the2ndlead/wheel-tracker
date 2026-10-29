// Trades entered by hand (fills missing from an export, or an account with no export at all).
// Each one becomes the same Transaction row(s) a Robinhood CSV would produce, so the engine
// treats it exactly like an imported trade.
import type { ImportNote, OptionType, Transaction } from '../engine/types';

export type ManualAction =
  | 'buy'
  | 'sell'
  | 'sto'
  | 'btc'
  | 'bto'
  | 'stc'
  | 'expired'
  | 'assigned'
  | 'exercised'
  | 'dividend'
  | 'deposit'
  | 'withdrawal';

export interface ManualTrade {
  id: string;
  /** ISO date YYYY-MM-DD */
  date: string;
  action: ManualAction;
  /** Empty for deposits and withdrawals. */
  ticker: string;
  /** Shares, or contracts for option actions. */
  quantity: number;
  /** Per share: share price, or option premium per share (1.25 = $125 a contract). */
  price: number;
  fees: number;
  option?: { type: OptionType; strike: number; expiry: string };
  /** Total cash for dividends, deposits and withdrawals (positive). */
  amount: number;
  note?: string;
}

export const ACTIONS: { value: ManualAction; label: string; kind: 'stock' | 'option' | 'cash' }[] = [
  { value: 'sto', label: 'Sell to open (sell a put / call)', kind: 'option' },
  { value: 'btc', label: 'Buy to close', kind: 'option' },
  { value: 'expired', label: 'Option expired', kind: 'option' },
  { value: 'assigned', label: 'Option assigned', kind: 'option' },
  { value: 'bto', label: 'Buy to open (buy a put / call)', kind: 'option' },
  { value: 'stc', label: 'Sell to close', kind: 'option' },
  { value: 'exercised', label: 'Option exercised (long)', kind: 'option' },
  { value: 'buy', label: 'Buy shares', kind: 'stock' },
  { value: 'sell', label: 'Sell shares', kind: 'stock' },
  { value: 'dividend', label: 'Dividend', kind: 'cash' },
  { value: 'deposit', label: 'Deposit', kind: 'cash' },
  { value: 'withdrawal', label: 'Withdrawal', kind: 'cash' },
];

export const actionKind = (a: ManualAction) => ACTIONS.find((x) => x.value === a)!.kind;
/** Actions with a trade price (the rest move contracts or cash at a fixed value). */
export const hasPrice = (a: ManualAction) => ['buy', 'sell', 'sto', 'btc', 'bto', 'stc'].includes(a);

const CODES: Record<ManualAction, string> = {
  buy: 'Buy',
  sell: 'Sell',
  sto: 'STO',
  btc: 'BTC',
  bto: 'BTO',
  stc: 'STC',
  expired: 'OEXP',
  assigned: 'OASGN',
  exercised: 'OEXCS',
  dividend: 'CDIV',
  deposit: 'ACH',
  withdrawal: 'ACH',
};

const usDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}/${y}`;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** "AAPL 10/18/2024 Put $220.00", the format the CSV parser reads. */
export function optionDescription(ticker: string, o: NonNullable<ManualTrade['option']>): string {
  return `${ticker} ${usDate(o.expiry)} ${o.type} $${o.strike.toFixed(2)}`;
}

/** Returns a problem with the trade, or null when it can be saved. */
export function validateManualTrade(t: ManualTrade): string | null {
  const kind = actionKind(t.action);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date)) return 'Enter the date.';
  if (kind !== 'cash' || t.action === 'dividend') if (!t.ticker.trim()) return 'Enter the ticker.';
  if (kind === 'cash') return t.amount > 0 ? null : 'Enter the amount.';
  if (!(t.quantity > 0)) return kind === 'option' ? 'Enter the number of contracts.' : 'Enter the number of shares.';
  if (kind === 'option' && !(t.option && t.option.strike > 0 && /^\d{4}-\d{2}-\d{2}$/.test(t.option.expiry))) return 'Enter the strike and expiration.';
  if (hasPrice(t.action) && !(t.price > 0)) return kind === 'option' ? 'Enter the premium per share (e.g. 1.25).' : 'Enter the price per share.';
  if (t.fees < 0) return "Fees can't be negative.";
  return null;
}

/** The CSV-equivalent row(s) for one manual trade. Assignments/exercises also get their stock leg. */
export function manualToTransactions(t: ManualTrade): Omit<Transaction, 'id'>[] {
  const ticker = t.ticker.trim().toUpperCase();
  const code = CODES[t.action];
  const base = { date: t.date, instrument: ticker, code, manual: true, source: 'Manual entry' };
  const fees = t.fees || 0;

  if (actionKind(t.action) === 'cash') {
    const description =
      t.action === 'dividend' ? `Cash Div: ${ticker}` : t.action === 'deposit' ? 'Deposit (manual entry)' : 'Withdrawal (manual entry)';
    return [{ ...base, instrument: t.action === 'dividend' ? ticker : '', description, quantity: 0, price: 0, amount: round2(t.action === 'withdrawal' ? -t.amount : t.amount) }];
  }

  if (actionKind(t.action) === 'stock') {
    const gross = t.quantity * t.price;
    const amount = t.action === 'buy' ? -(gross + fees) : gross - fees;
    return [{ ...base, description: ticker, quantity: t.quantity, price: t.price, amount: round2(amount) }];
  }

  const o = t.option!;
  const option = { underlying: ticker, expiry: o.expiry, type: o.type, strike: o.strike };
  const desc = optionDescription(ticker, o);
  if (hasPrice(t.action)) {
    const gross = t.price * 100 * t.quantity;
    const credit = t.action === 'sto' || t.action === 'stc';
    return [{ ...base, description: desc, option, quantity: t.quantity, price: t.price, amount: round2(credit ? gross - fees : -(gross + fees)) }];
  }
  if (t.action === 'expired') {
    return [{ ...base, description: `Option Expiration for ${desc}`, option, quantity: t.quantity, price: 0, amount: 0 }];
  }
  // Assigned short put / exercised long call → buy shares at the strike; otherwise sell.
  const buys = (t.action === 'assigned') === (o.type === 'Put');
  const shares = t.quantity * 100;
  const gross = shares * o.strike;
  return [
    { ...base, description: desc, option, quantity: t.quantity, price: 0, amount: 0 },
    {
      ...base,
      code: buys ? 'Buy' : 'Sell',
      description: `${ticker} (${t.action === 'assigned' ? 'assignment' : 'exercise'} of ${desc})`,
      quantity: shares,
      price: o.strike,
      amount: round2(buys ? -(gross + fees) : gross - fees),
    },
  ];
}

const close = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const sameRow = (m: Omit<Transaction, 'id'>, c: Transaction) =>
  m.date === c.date &&
  m.code === c.code &&
  m.instrument === c.instrument &&
  close(m.quantity, c.quantity, 1e-6) &&
  close(m.amount, c.amount, 0.05) &&
  (!m.option || (!!c.option && c.option.type === m.option.type && c.option.expiry === m.option.expiry && close(c.option.strike, m.option.strike, 0.001)));

/**
 * Adds manual trades to the imported rows. On the same day, imported rows come first and manual
 * ones follow in the order they were entered. A manual trade that matches an imported row is
 * still counted, but flagged so it can be deleted once the export covers it.
 */
export function withManualTrades(imported: Transaction[], manual: ManualTrade[]): { transactions: Transaction[]; warnings: ImportNote[] } {
  if (!manual.length) return { transactions: imported, warnings: [] };
  const warnings: ImportNote[] = [];
  const all: { t: Omit<Transaction, 'id'>; order: number }[] = imported.map((t, i) => ({ t, order: i }));
  let order = imported.length;
  for (const m of manual) {
    const rows = manualToTransactions(m);
    if (imported.some((c) => sameRow(rows[0], c))) {
      warnings.push({
        text: `Manual trade on ${m.date} (${rows[0].code} ${rows[0].description}) is also in your imported report, so it's counted twice. Delete it under Trades.`,
        ticker: rows[0].instrument || undefined,
      });
    }
    for (const t of rows) all.push({ t, order: order++ });
  }
  const transactions = all
    .sort((a, b) => a.t.date.localeCompare(b.t.date) || a.order - b.order)
    .map(({ t }, i) => ({ ...t, id: i }) as Transaction);
  return { transactions, warnings };
}
