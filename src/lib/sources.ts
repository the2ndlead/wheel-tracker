// What a portfolio is built from: per account, its parsed CSVs, its manual trades and its
// opening balances. Kept separate from building, so "what if" trades (a planned roll) can be
// added to one account and the portfolio rebuilt exactly the way the app builds it.
import { buildCombinedPortfolio, buildPortfolio } from '../engine/ledger';
import type { BasisOptions, ImportNote, OpeningBalances, Portfolio, Transaction } from '../engine/types';
import type { MergeResult } from '../parser/merge';
import { withManualTrades, type ManualTrade } from '../parser/manual';

export interface AccountSource {
  id: string;
  name: string;
  csv: MergeResult;
  manual: ManualTrade[];
  opening: OpeningBalances;
}

export const EMPTY_MERGE: MergeResult = { transactions: [], warnings: [], duplicates: 0, files: [] };

/** Hypothetical trades added to one account (not saved anywhere). */
export interface ExtraTrades {
  accountId: string;
  trades: ManualTrade[];
}

export interface Built {
  /** The single account's rows (CSV + manual), oldest first; null in the combined view. */
  transactions: Transaction[] | null;
  portfolio: Portfolio;
}

/**
 * @param combined true = the "All accounts" view: every source is built on its own and summed.
 */
export function buildFromSources(sources: AccountSource[], combined: boolean, basis: BasisOptions, extra?: ExtraTrades): Built | null {
  const rows = (s: AccountSource) => withManualTrades(s.csv.transactions, [...s.manual, ...(extra?.accountId === s.id ? extra.trades : [])]);
  const used = sources.filter((s) => s.csv.transactions.length || s.manual.length);
  if (!used.length) return null;

  if (!combined) {
    const s = used[0];
    const w = rows(s);
    const p = buildPortfolio(w.transactions, { opening: s.opening, basis });
    const notes: ImportNote[] = [...s.csv.warnings, ...w.warnings];
    if (s.csv.duplicates) notes.push({ text: `${s.csv.duplicates} duplicate row(s) skipped where the selected files overlap.` });
    p.warnings.unshift(...notes);
    return { transactions: w.transactions, portfolio: p };
  }

  const notes: ImportNote[] = [];
  const parts = used.map((s) => {
    const w = rows(s);
    notes.push(...[...s.csv.warnings, ...w.warnings].map((x) => ({ ...x, text: `${s.name}: ${x.text}` })));
    return { name: s.name, transactions: w.transactions, opening: s.opening };
  });
  const p = buildCombinedPortfolio(parts, { basis });
  p.warnings.unshift(...notes);
  return { transactions: null, portfolio: p };
}

/** The account holding an open option; in the combined view its key is prefixed "<account name>:". */
export function ownerOf(sources: AccountSource[], combined: boolean, optionKey: string): AccountSource | undefined {
  if (!combined) return sources[0];
  return sources.find((s) => optionKey.startsWith(`${s.name}:`));
}
