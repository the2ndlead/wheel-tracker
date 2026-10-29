import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseRobinhoodCsv } from '../parser/robinhood';
import { buildCombinedPortfolio, buildPortfolio } from './ledger';
import type { BasisOptions, EngineOptions } from './types';

function csv(rows: string[][]): string {
  const header = '"Activity Date","Process Date","Settle Date","Instrument","Description","Trans Code","Quantity","Price","Amount"';
  const q = (r: string[]) => [r[0], r[0], r[0], ...r.slice(1)].map((c) => `"${c}"`).join(',');
  return [header, ...[...rows].reverse().map(q)].join('\n');
}
const txs = (text: string) => parseRobinhoodCsv(text).transactions;
const build = (text: string, opts: EngineOptions = {}) => buildPortfolio(txs(text), { today: '2024-06-01', ...opts });
const basis = (b: Partial<BasisOptions>): BasisOptions => ({ includeDividends: false, includeLongOptions: false, scope: 'all', realizedOnly: true, ...b });

// 100 XYZ @ 50 via an assigned put, then a covered call: 2 contracts of the
// $55 call were never sold; instead we sell 1 call, buy it back, sell another that's still open.
const wheel = csv([
  ['1/2/2024', 'XYZ', 'XYZ 1/19/2024 Put $50.00', 'STO', '1', '$1.50', '$150.00'],
  ['1/19/2024', 'XYZ', 'XYZ Corp', 'Buy', '100', '$50.00', '($5,000.00)'],
  ['1/19/2024', 'XYZ', 'XYZ 1/19/2024 Put $50.00', 'OASGN', '1', '', ''],
  ['1/22/2024', 'XYZ', 'XYZ 2/16/2024 Call $55.00', 'STO', '1', '$1.00', '$100.00'],
  ['2/1/2024', 'XYZ', 'XYZ 2/16/2024 Call $55.00', 'BTC', '1', '$0.30', '($30.00)'],
  ['2/2/2024', 'XYZ', 'XYZ 3/15/2024 Call $55.00', 'STO', '1', '$1.20', '$120.00'],
  ['2/9/2024', 'XYZ', 'Cash Div', 'CDIV', '', '', '$10.00'],
]);

describe('realized vs including open premium', () => {
  it('realized-only leaves out premium from contracts still open', () => {
    const xyz = build(wheel).tickers[0];
    // Counted: 150 put (assigned) + 100 − 30 (closed call). Not counted: the open 120 call.
    expect(xyz.basisReduction).toBeCloseTo(220);
    expect(xyz.trueCostBasis).toBeCloseTo((5000 - 220) / 100);
    expect(xyz.openPremium).toBeCloseTo(120);
  });

  it('including open premium counts it as soon as it is received', () => {
    const xyz = build(wheel, { basis: basis({ realizedOnly: false }) }).tickers[0];
    expect(xyz.basisReduction).toBeCloseTo(340);
  });

  it('the basis-over-time chart agrees with the final number in both modes', () => {
    for (const realizedOnly of [true, false]) {
      const xyz = build(wheel, { basis: basis({ realizedOnly }) }).tickers[0];
      expect(xyz.history[xyz.history.length - 1].trueBasis).toBeCloseTo(xyz.trueCostBasis!);
    }
  });

  it('partly closed contracts count only the closed share', () => {
    const p = build(
      csv([
        ['1/2/2024', 'XYZ', 'XYZ Corp', 'Buy', '200', '$50.00', '($10,000.00)'],
        ['1/3/2024', 'XYZ', 'XYZ 2/16/2024 Call $55.00', 'STO', '2', '$1.00', '$200.00'],
        ['1/10/2024', 'XYZ', 'XYZ 2/16/2024 Call $55.00', 'BTC', '1', '$0.40', '($40.00)'],
      ]),
    ).tickers[0];
    // 1 of 2 contracts closed: 100 of the 200 credit is realized, minus the 40 buyback.
    expect(p.basisReduction).toBeCloseTo(60);
    expect(p.openPremium).toBeCloseTo(100);
  });
});

describe('basis items (which trades lowered the basis)', () => {
  it('lists every premium and dividend, and their counted amounts add up to the reduction', () => {
    const xyz = build(wheel, { basis: basis({ includeDividends: true }) }).tickers[0];
    expect(xyz.basisItems.map((i) => [i.code, i.amount, i.counted])).toEqual([
      ['STO', 150, 150],
      ['STO', 100, 100],
      ['BTC', -30, -30],
      ['STO', 120, 0],
      ['CDIV', 10, 10],
    ]);
    expect(xyz.basisItems.reduce((s, i) => s + i.counted, 0)).toBeCloseTo(xyz.basisReduction);
    expect(xyz.basisItems[3].openAmount).toBeCloseTo(120);
  });

  it('marks dividends as not counted unless that option is on', () => {
    const xyz = build(wheel).tickers[0];
    expect(xyz.basisItems.find((i) => i.kind === 'dividend')!.counted).toBe(0);
  });
});

describe('all accounts combined', () => {
  const ira = csv([
    ['1/2/2024', '', 'ACH Deposit', 'ACH', '', '', '$10,000.00'],
    ['1/3/2024', 'XYZ', 'XYZ Corp', 'Buy', '100', '$50.00', '($5,000.00)'],
    ['1/4/2024', 'XYZ', 'XYZ 2/16/2024 Call $55.00', 'BTC', '1', '$0.50', '($50.00)'], // sold before export
  ]);
  const brokerage = csv([
    ['1/5/2024', 'XYZ', 'XYZ Corp', 'Buy', '100', '$40.00', '($4,000.00)'], // no deposit: starting cash estimated
    ['1/6/2024', 'XYZ', 'XYZ 1/19/2024 Call $45.00', 'STO', '1', '$2.00', '$200.00'],
    ['1/19/2024', 'XYZ', 'Option Expiration for XYZ 1/19/2024 Call $45.00', 'OEXP', '1', '', ''],
  ]);
  const p = buildCombinedPortfolio(
    [
      { name: 'IRA', transactions: txs(ira) },
      { name: 'Brokerage', transactions: txs(brokerage) },
    ],
    { today: '2024-06-01' },
  );
  const xyz = p.tickers[0];

  it('combines positions in the same ticker into one overall cost basis', () => {
    expect(xyz.shares).toBe(200);
    expect(xyz.costRaw).toBeCloseTo(9000);
    expect(xyz.trueCostBasis).toBeCloseTo((9000 - 200) / 200);
  });

  it('estimates starting cash per account, not for the total', () => {
    // IRA never goes negative; brokerage needs 4000 to cover its first buy.
    expect(p.openingCash).toBeCloseTo(4000);
    expect(p.openingCashEstimated).toBe(true);
    expect(p.cash).toBeCloseTo(10000 - 5000 - 50 + 4000 - 4000 + 200);
    expect(p.fileCash).toBeCloseTo(p.cash - 4000);
  });

  it('keeps per-account warnings and tags rows with their account', () => {
    expect(p.warnings.some((w) => w.ticker === 'XYZ' && w.action === 'opening-option')).toBe(true);
    expect(new Set(xyz.transactions.map((t) => t.source))).toEqual(new Set(['IRA', 'Brokerage']));
    expect(p.transactionCount).toBe(6);
  });
});

describe('fixture sanity', () => {
  it('realized default still matches hand numbers on sample.csv', () => {
    const p = buildPortfolio(txs(fs.readFileSync(path.resolve(__dirname, '../../fixtures/sample.csv'), 'utf8')), { today: '2024-09-01' });
    expect(p.tickers.find((t) => t.ticker === 'MSFT')!.basisItems.filter((i) => i.counted !== 0)).toHaveLength(1);
  });
});

describe('combined accounts stay independent', () => {
  it("one account's round trip doesn't change another account's average cost", () => {
    const a = csv([
      ['1/2/2024', '', 'ACH Deposit', 'ACH', '', '', '$10,000.00'],
      ['1/3/2024', 'AMZN', 'Amazon', 'Buy', '100', '$50.00', '($5,000.00)'],
    ]);
    const b = csv([
      ['1/2/2024', '', 'ACH Deposit', 'ACH', '', '', '$1,000.00'],
      ['1/4/2024', 'AMZN', 'Amazon', 'Buy', '10', '$40.00', '($400.00)'],
      ['1/5/2024', 'AMZN', 'Amazon', 'Sell', '10', '$45.00', '$450.00'],
    ]);
    const p = buildCombinedPortfolio(
      [
        { name: 'A', transactions: txs(a) },
        { name: 'B', transactions: txs(b) },
      ],
      { today: '2024-06-01' },
    );
    const amzn = p.tickers[0];
    expect(amzn.shares).toBe(100);
    expect(amzn.avgCost).toBeCloseTo(50); // pooling the trades would give 50.45
    expect(amzn.realizedStock).toBeCloseTo(50); // B's own +$50
    expect(amzn.history[amzn.history.length - 1]).toMatchObject({ shares: 100, avgCost: 50 });
    expect(amzn.history.find((h) => h.date === '2024-01-04')!.shares).toBe(110);
  });
});
