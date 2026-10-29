import { describe, expect, it } from 'vitest';
import { parseRobinhoodCsv } from '../parser/robinhood';
import { buildPortfolio, estimateOpeningCash } from './ledger';
import type { EngineOptions } from './types';

/** Exports that start partway through an account's history. Rows written oldest-first. */
function csv(rows: string[][]): string {
  const header = '"Activity Date","Process Date","Settle Date","Instrument","Description","Trans Code","Quantity","Price","Amount"';
  const q = (r: string[]) => [r[0], r[0], r[0], ...r.slice(1)].map((c) => `"${c}"`).join(',');
  return [header, ...[...rows].reverse().map(q)].join('\n');
}
const build = (text: string, opts: EngineOptions = {}) => buildPortfolio(parseRobinhoodCsv(text).transactions, { today: '2024-06-01', ...opts });

const partial = csv([
  ['1/2/2024', 'ABC', 'ABC 1/19/2024 Put $20.00', 'BTC', '2', '$0.50', '($100.00)'], // sold in 2023
  ['1/3/2024', 'SLV', 'SLV 1/15/2027 Call $55.00', 'STC', '1', '$19.00', '$1,900.00'], // bought in 2023
  ['1/4/2024', 'XYZ', 'XYZ Corp', 'Buy', '100', '$50.00', '($5,000.00)'],
  ['1/5/2024', 'XYZ', 'XYZ 2/16/2024 Call $55.00', 'STO', '1', '$1.00', '$100.00'],
  ['1/8/2024', '', 'Conversion from Traditional IRA', 'CFRI', '', '', '$1,000.00'],
]);
// Running cash: −100, +1800, −3200 (low), −3100, −2100.

describe('starting cash estimate', () => {
  it('looks at end-of-day balances, not the order of rows within a day', () => {
    const sameDay = csv([
      ['1/2/2024', 'XYZ', 'XYZ Corp', 'Buy', '10', '$50.00', '($500.00)'],
      ['1/2/2024', 'ABC', 'ABC Corp', 'Sell', '10', '$60.00', '$600.00'],
    ]);
    expect(estimateOpeningCash(parseRobinhoodCsv(sameDay).transactions)).toBe(0);
  });

  it('is the smallest starting balance that keeps cash at or above $0', () => {
    expect(estimateOpeningCash(parseRobinhoodCsv(partial).transactions)).toBeCloseTo(3200);
  });

  it('is applied automatically when no starting cash is entered', () => {
    const p = build(partial);
    expect(p.openingCashEstimated).toBe(true);
    expect(p.openingCash).toBeCloseTo(3200);
    expect(p.fileCash).toBeCloseTo(-2100);
    expect(p.cash).toBeCloseTo(1100);
    expect(p.netDeposits).toBeCloseTo(3200 + 1000);
  });

  it('uses an entered amount (even 0) instead of the estimate', () => {
    const p = build(partial, { opening: { asOf: null, cash: 0, positions: [], options: [] } });
    expect(p.openingCashEstimated).toBe(false);
    expect(p.cash).toBeCloseTo(-2100);
    const q = build(partial, { opening: { asOf: null, cash: 5000, positions: [], options: [] } });
    expect(q.cash).toBeCloseTo(2900);
  });

  it('is not used when cash never goes negative', () => {
    const p = build(csv([['1/2/2024', '', 'ACH Deposit', 'ACH', '', '', '$1,000.00']]));
    expect(p.openingCashEstimated).toBe(false);
    expect(p.openingCash).toBe(0);
  });
});

describe('trades opened before the export starts', () => {
  const p = build(partial);
  const get = (t: string) => p.tickers.find((x) => x.ticker === t)!;

  it('leaves an unmatched buyback out of wheel premium', () => {
    expect(get('ABC').wheelPremium).toBe(0);
    expect(p.premiumByMonth).toEqual([{ month: '2024-01', premium: 100 }]);
    expect(p.warnings.find((w) => w.ticker === 'ABC')).toMatchObject({ action: 'opening-option' });
  });

  it('leaves an unmatched long sale out of options P/L', () => {
    expect(get('SLV').otherOptionsPL).toBe(0);
    expect(p.longTrades).toHaveLength(0);
    expect(p.warnings.find((w) => w.ticker === 'SLV')!.text).toContain('$1,900.00');
  });

  it('still counts both in cash', () => {
    expect(p.fileCash).toBeCloseTo(-100 + 1900 - 5000 + 100 + 1000);
  });

  it('counts the matched part of a partly-unmatched buyback', () => {
    const q = build(partial, {
      opening: { asOf: null, cash: null, positions: [], options: [{ ticker: 'ABC', type: 'Put', strike: 20, expiry: '2024-01-19', contracts: 1, premium: 150 }] },
    });
    // 1 of 2 contracts known: +150 credit − 50 (half the buyback).
    expect(q.tickers.find((t) => t.ticker === 'ABC')!.wheelPremium).toBeCloseTo(100);
    expect(q.shortTrades[0]).toMatchObject({ contracts: 1, netPremium: 100 });
  });
});

describe('share transfers and receipts', () => {
  const p = build(
    csv([
      ['1/2/2024', '', 'ACH Deposit', 'ACH', '', '', '$2,000.00'],
      ['1/3/2024', 'VUG', 'Vanguard Growth', 'Buy', '2', '$400.00', '($800.00)'],
      ['1/4/2024', 'VUG', 'Vanguard Growth', 'ITRF', '1S', '', ''],
      ['1/5/2024', '', 'Transfer from Brokerage to Traditional IRA', 'ITRF', '', '', '($500.00)'],
      ['1/6/2024', 'AMZN', 'Amazon', 'REC', '0.0215', '', ''],
      ['1/9/2024', 'AMZN', 'Amazon', 'Sell', '0.0215', '$245.00', '$5.27'],
    ]),
  );
  const get = (t: string) => p.tickers.find((x) => x.ticker === t)!;

  it('treats an ITRF of shares the account holds as shares leaving at cost', () => {
    expect(get('VUG').shares).toBe(1);
    expect(get('VUG').costRaw).toBeCloseTo(400);
    expect(get('VUG').realizedStock).toBe(0);
  });

  it('counts cash ITRF rows and shares moved out as withdrawals', () => {
    expect(p.netDeposits).toBeCloseTo(2000 - 400 - 500);
    expect(p.warnings.some((w) => w.text.includes('Unrecognized'))).toBe(false);
  });

  it('adds received shares at $0 cost', () => {
    expect(get('AMZN').shares).toBe(0);
    expect(get('AMZN').realizedStock).toBeCloseTo(5.27);
    expect(p.warnings.some((w) => w.ticker === 'AMZN' && w.text.includes('received'))).toBe(true);
  });
});

describe('fractional rounding', () => {
  it('treats a tiny leftover after selling a fraction as fully sold', () => {
    const p = build(
      csv([
        ['1/6/2024', 'AMZN', 'Amazon', 'REC', '0.0215', '', ''],
        ['1/9/2024', 'AMZN', 'Amazon', 'Sell', '0.021468', '$245.70', '$5.27'],
      ]),
    );
    expect(p.tickers[0].shares).toBe(0);
    expect(p.tickers[0].trueCostBasis).toBeNull();
  });
});
