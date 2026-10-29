import Papa from 'papaparse';
import type { ImportNote, OptionInfo, ParseResult, Transaction } from '../engine/types';

/**
 * Parses a Robinhood "Account activity" CSV export.
 * Columns: Activity Date, Process Date, Settle Date, Instrument, Description, Trans Code, Quantity, Price, Amount
 * Robinhood exports newest-first; the result is returned oldest-first.
 */
export function parseRobinhoodCsv(text: string): ParseResult {
  const warnings: ImportNote[] = [];
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });

  const required = ['Activity Date', 'Trans Code', 'Amount'];
  const fields = parsed.meta.fields ?? [];
  const missing = required.filter((f) => !fields.includes(f));
  if (missing.length) {
    throw new Error(
      `This doesn't look like a Robinhood activity export (missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}).`,
    );
  }

  const rows: Transaction[] = [];
  parsed.data.forEach((row, i) => {
    const date = parseDate(row['Activity Date']);
    // Footer disclaimer rows and blank lines have no valid date.
    if (!date) return;

    const code = (row['Trans Code'] ?? '').trim();
    const instrument = (row['Instrument'] ?? '').trim().toUpperCase();
    const description = (row['Description'] ?? '').trim();
    const tx: Transaction = {
      id: i,
      date,
      instrument,
      description,
      code,
      quantity: Math.abs(parseNumber(row['Quantity'])),
      price: parseMoney(row['Price']),
      amount: parseMoney(row['Amount']),
    };
    const option = parseOptionDescription(description);
    if (option) {
      tx.option = option;
      if (!tx.instrument) tx.instrument = option.underlying;
    }
    if (!code) {
      warnings.push({ text: `Row ${i + 2}: no transaction code (${description.split('\n')[0] || 'no description'}).` });
    }
    rows.push(tx);
  });

  // File is newest-first; reverse to oldest-first, then stable-sort by date so
  // same-day rows keep their original relative order.
  rows.reverse();
  const transactions = rows
    .map((t, idx) => ({ t, idx }))
    .sort((a, b) => a.t.date.localeCompare(b.t.date) || a.idx - b.idx)
    .map(({ t }) => t);

  return { transactions, warnings };
}

/** "$1,234.56" → 1234.56, "($1,234.56)" → -1234.56, "" → 0 */
export function parseMoney(value: string | undefined): number {
  if (!value) return 0;
  const s = value.trim();
  if (!s) return 0;
  const negative = /^\(.*\)$/.test(s) || s.startsWith('-');
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  if (Number.isNaN(n)) return 0;
  return negative ? -n : n;
}

/** Strips suffixes like "5S" (split-adjusted) and thousands separators. */
export function parseNumber(value: string | undefined): number {
  if (!value) return 0;
  const n = parseFloat(value.replace(/[^0-9.\-]/g, ''));
  return Number.isNaN(n) ? 0 : n;
}

/** "10/18/2024" → "2024-10-18" */
export function parseDate(value: string | undefined): string | null {
  if (!value) return null;
  const m = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

const OPTION_RE = /([A-Z][A-Z0-9.]*)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(Call|Put)\s+\$([\d,]+(?:\.\d+)?)/i;

/**
 * Finds "AAPL 10/18/2024 Put $220.00" anywhere in a description, which also
 * covers "Option Expiration for AAPL 10/18/2024 Put $220.00".
 */
export function parseOptionDescription(description: string): OptionInfo | undefined {
  const m = description.match(OPTION_RE);
  if (!m) return undefined;
  const expiry = parseDate(m[2]);
  if (!expiry) return undefined;
  return {
    underlying: m[1].toUpperCase(),
    expiry,
    type: m[3].toLowerCase() === 'call' ? 'Call' : 'Put',
    strike: parseFloat(m[4].replace(/,/g, '')),
  };
}
