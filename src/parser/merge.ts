import type { ImportNote, Transaction } from '../engine/types';
import { parseRobinhoodCsv } from './robinhood';

export interface CsvFile {
  name: string;
  text: string;
}

export interface MergeResult {
  transactions: Transaction[];
  warnings: ImportNote[];
  /** Rows dropped because another file already had them. */
  duplicates: number;
  files: { name: string; rows: number; firstDate: string | null; lastDate: string | null }[];
}

const rowKey = (t: Transaction) => [t.date, t.code, t.instrument, t.description, t.quantity, t.price, t.amount].join('|');

/**
 * Parses and combines several Robinhood exports (e.g. 2025 + 2026, or two
 * overlapping date ranges). Identical rows can be real (two fills at the same
 * price), so for each distinct row we keep the highest count seen in any single
 * file rather than the sum across files.
 */
export function mergeCsvFiles(files: CsvFile[]): MergeResult {
  const warnings: ImportNote[] = [];
  const parsed = files.map((f) => {
    try {
      return { name: f.name, ...parseRobinhoodCsv(f.text) };
    } catch (e) {
      throw new Error(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  // Oldest export first, so overlap is resolved in favour of the earlier file's row order.
  parsed.sort((a, b) => (a.transactions[0]?.date ?? '').localeCompare(b.transactions[0]?.date ?? ''));

  const taken = new Map<string, number>();
  const kept: { t: Transaction; order: number }[] = [];
  let duplicates = 0;
  let order = 0;

  for (const file of parsed) {
    warnings.push(...file.warnings.map((w) => (files.length > 1 ? { ...w, text: `${file.name}: ${w.text}` } : w)));
    const local = new Map<string, number>();
    for (const t of file.transactions) {
      const key = rowKey(t);
      const n = (local.get(key) ?? 0) + 1;
      local.set(key, n);
      if (n > (taken.get(key) ?? 0)) {
        taken.set(key, n);
        kept.push({ t: { ...t, source: file.name }, order: order++ });
      } else {
        duplicates++;
      }
    }
  }

  const transactions = kept
    .sort((a, b) => a.t.date.localeCompare(b.t.date) || a.order - b.order)
    .map(({ t }, i) => ({ ...t, id: i }));

  return {
    transactions,
    warnings,
    duplicates,
    files: parsed.map((f) => ({
      name: f.name,
      rows: f.transactions.length,
      firstDate: f.transactions[0]?.date ?? null,
      lastDate: f.transactions[f.transactions.length - 1]?.date ?? null,
    })),
  };
}
