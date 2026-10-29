import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseMoney, parseOptionDescription, parseRobinhoodCsv } from '../parser/robinhood';
import { mergeCsvFiles } from '../parser/merge';
import { buildPortfolio } from './ledger';
import type { EngineOptions } from './types';

const fixture = (name: string) => fs.readFileSync(path.resolve(__dirname, '../../fixtures', name), 'utf8');
const sample = fixture('sample.csv');
const sample2 = fixture('sample-2.csv');
const TODAY = '2024-09-01';

/** Builds a Robinhood CSV from rows written oldest-first (the real export is newest-first). */
function csv(rows: string[][]): string {
  const header = '"Activity Date","Process Date","Settle Date","Instrument","Description","Trans Code","Quantity","Price","Amount"';
  const q = (r: string[]) => [r[0], r[0], r[0], ...r.slice(1)].map((c) => `"${c}"`).join(',');
  return [header, ...[...rows].reverse().map(q)].join('\n');
}

const build = (text: string, opts: EngineOptions = {}) => buildPortfolio(parseRobinhoodCsv(text).transactions, { today: TODAY, ...opts });

describe('parser', () => {
  it('parses money formats', () => {
    expect(parseMoney('$1,234.56')).toBe(1234.56);
    expect(parseMoney('($18,500.00)')).toBe(-18500);
    expect(parseMoney('')).toBe(0);
  });

  it('parses option descriptions, including expiry/assignment prefixes', () => {
    expect(parseOptionDescription('Option Expiration for AAPL 1/19/2024 Put $180.00')).toEqual({
      underlying: 'AAPL',
      expiry: '2024-01-19',
      type: 'Put',
      strike: 180,
    });
    expect(parseOptionDescription('Apple\nCUSIP: 037833100')).toBeUndefined();
  });

  it('drops the disclaimer footer and returns oldest-first', () => {
    const { transactions } = parseRobinhoodCsv(sample);
    expect(transactions).toHaveLength(18);
    expect(transactions[0].code).toBe('ACH');
    expect(transactions[transactions.length - 1].code).toBe('INT');
    expect(transactions.find((t) => t.code === 'OEXP')!.quantity).toBe(1);
  });

  it('rejects files that are not Robinhood exports', () => {
    expect(() => parseRobinhoodCsv('a,b\n1,2')).toThrow(/Robinhood/);
  });
});

describe('ledger', () => {
  const p = build(sample);
  const get = (t: string) => p.tickers.find((x) => x.ticker === t)!;

  it('wheels AAPL from CSP to called away, inferring the missing stock sale', () => {
    const aapl = get('AAPL');
    expect(aapl.shares).toBe(0);
    expect(aapl.wheelPremium).toBeCloseTo(250 + 300 + 200 - 50 + 150);
    expect(aapl.putPremium).toBeCloseTo(550);
    expect(aapl.callPremium).toBeCloseTo(300);
    expect(aapl.realizedStock).toBeCloseTo(19000 - 18500);
    expect(aapl.openOptions).toHaveLength(0);
    expect(aapl.trueCostBasis).toBeNull();
    expect(p.warnings.some((w) => w.text.includes('inferred Sell 100'))).toBe(true);
  });

  it('computes true cost basis for MSFT held with an open covered call', () => {
    const msft = get('MSFT');
    expect(msft.shares).toBe(100);
    expect(msft.avgCost).toBeCloseTo(400);
    expect(msft.wheelPremium).toBeCloseTo(800);
    // Default is realized-only: the open $420 call's $300 isn't counted yet, the assigned put's $500 is.
    expect(msft.trueCostBasis).toBeCloseTo(395);
    expect(msft.openPremium).toBeCloseTo(300);
    expect(msft.dividends).toBeCloseTo(75);
    expect(msft.openOptions).toHaveLength(1);
    expect(msft.openOptions[0]).toMatchObject({ side: 'short', type: 'Call', strike: 420, contracts: 1 });
  });

  it('does not use put assignment stock row twice', () => {
    expect(get('MSFT').transactions.filter((t) => t.code === 'Buy')).toHaveLength(1);
    expect(get('MSFT').transactions.some((t) => t.synthetic)).toBe(false);
  });

  it('keeps long options out of the basis', () => {
    const spy = get('SPY');
    expect(spy.otherOptionsPL).toBeCloseTo(250);
    expect(spy.wheelPremium).toBe(0);
    expect(p.longTrades).toEqual([expect.objectContaining({ ticker: 'SPY', outcome: 'closed', cost: 400, proceeds: 650, pl: 250 })]);
  });

  it('tracks account cash, deposits and premium', () => {
    expect(p.netDeposits).toBe(50000);
    expect(p.interest).toBeCloseTo(12.34);
    expect(p.totalPremium).toBeCloseTo(1650);
    expect(p.cash).toBeCloseTo(12487.34);
    expect(p.premiumByMonth.find((m) => m.month === '2024-03')!.premium).toBeCloseTo(100);
  });
});

describe('wheel cycles and short trades', () => {
  const p = build(sample);
  const aapl = p.tickers.find((t) => t.ticker === 'AAPL')!;
  const msft = p.tickers.find((t) => t.ticker === 'MSFT')!;

  it('splits AAPL into an expired-CSP cycle and a full wheel', () => {
    expect(aapl.cycles).toHaveLength(2);
    const [c1, c2] = aapl.cycles;
    expect(c1).toMatchObject({ start: '2024-01-03', end: '2024-01-19', status: 'closed', premium: 250, capital: 18000, days: 16 });
    expect(c2).toMatchObject({ start: '2024-01-22', end: '2024-03-28', status: 'closed', assignments: 1, calledAway: 1, days: 66 });
    expect(c2.premium).toBeCloseTo(600);
    expect(c2.stockPL).toBeCloseTo(500);
    expect(c2.totalReturn).toBeCloseTo(1100);
    // Capital is the 18,500 put collateral that turned into shares, not both added together.
    expect(c2.capital).toBeCloseTo(18500);
    expect(c2.annualizedPct!).toBeCloseTo((1100 / 18500) * (365 / 66));
  });

  it('keeps MSFT as one open cycle', () => {
    expect(msft.cycles).toHaveLength(1);
    expect(msft.cycles[0]).toMatchObject({ status: 'open', end: null, capital: 40000, dividends: 75 });
    expect(msft.cycles[0].premium).toBeCloseTo(800);
    expect(p.cycles[0].status).toBe('open');
  });

  it('pairs every short option open with its close', () => {
    expect(p.shortTrades).toHaveLength(5);
    const expired = p.shortTrades.find((t) => t.outcome === 'expired')!;
    expect(expired).toMatchObject({ ticker: 'AAPL', strike: 180, netPremium: 250, collateral: 18000, days: 16, win: true });
    expect(expired.annualizedYield).toBeCloseTo((250 / 18000) * (365 / 16));
    const closed = p.shortTrades.find((t) => t.outcome === 'closed')!;
    expect(closed.netPremium).toBeCloseTo(150);
    expect(p.shortTrades.filter((t) => t.outcome === 'assigned')).toHaveLength(3);
  });
});

describe('basis options', () => {
  it('can include dividends', () => {
    const msft = build(sample, { basis: { includeDividends: true, includeLongOptions: false, scope: 'all', realizedOnly: false } }).tickers.find((t) => t.ticker === 'MSFT')!;
    expect(msft.basisReduction).toBeCloseTo(875);
    expect(msft.trueCostBasis).toBeCloseTo(391.25);
  });

  it('can limit premium to the current cycle', () => {
    const text = csv([
      ['1/2/2024', 'XYZ', 'XYZ 1/19/2024 Put $50.00', 'STO', '1', '$1.00', '$100.00'],
      ['1/19/2024', 'XYZ', 'Option Expiration for XYZ 1/19/2024 Put $50.00', 'OEXP', '1', '', ''],
      ['1/22/2024', 'XYZ', 'XYZ Corp', 'Buy', '100', '$50.00', '($5,000.00)'],
      ['1/23/2024', 'XYZ', 'XYZ 2/16/2024 Call $55.00', 'STO', '1', '$0.80', '$80.00'],
    ]);
    const all = build(text, { basis: { includeDividends: false, includeLongOptions: false, scope: 'all', realizedOnly: false } }).tickers[0];
    expect(all.trueCostBasis).toBeCloseTo((5000 - 180) / 100);
    const cycle = build(text, { basis: { includeDividends: false, includeLongOptions: false, scope: 'currentCycle', realizedOnly: false } }).tickers[0];
    expect(cycle.trueCostBasis).toBeCloseTo((5000 - 80) / 100);
  });
});

describe('long option exercise', () => {
  const p = build(sample2);
  const nvda = p.tickers.find((t) => t.ticker === 'NVDA')!;

  it('adds the premium paid to share cost, not to wheel premium or options P/L', () => {
    expect(nvda.shares).toBe(100);
    expect(nvda.costRaw).toBeCloseTo(10500);
    expect(nvda.avgCost).toBeCloseTo(105);
    expect(nvda.wheelPremium).toBeCloseTo(250);
    expect(nvda.trueCostBasis).toBeCloseTo(105); // the $250 call is still open
    const withOpen = build(sample2, { basis: { includeDividends: false, includeLongOptions: false, scope: 'all', realizedOnly: false } });
    expect(withOpen.tickers.find((t) => t.ticker === 'NVDA')!.trueCostBasis).toBeCloseTo(102.5);
    expect(nvda.otherOptionsPL).toBe(0);
    expect(nvda.exercises).toEqual([expect.objectContaining({ type: 'Call', strike: 100, contracts: 1, premiumPaid: 500 })]);
    expect(p.longTrades.find((t) => t.ticker === 'NVDA')).toMatchObject({ outcome: 'exercised', pl: null, cost: 500 });
  });
});

describe('merging exports', () => {
  it('drops overlap between files but keeps identical fills within a file', () => {
    const m = mergeCsvFiles([
      { name: 'b.csv', text: sample2 },
      { name: 'a.csv', text: sample },
    ]);
    expect(m.duplicates).toBe(2); // the 6/20 STC and 7/1 INT rows appear in both
    expect(m.transactions).toHaveLength(18 + 8 - 2);
    expect(m.transactions.filter((t) => t.instrument === 'SGOV')).toHaveLength(2);
    expect(new Set(m.transactions.map((t) => t.id)).size).toBe(m.transactions.length);
    const p = buildPortfolio(m.transactions, { today: TODAY });
    expect(p.fileCash).toBeCloseTo(12487.34 - 500 - 2000 - 10000 + 250);
    // The NVDA purchase takes the fixture's running cash to −$12.66, so that much starting cash is estimated.
    expect(p.openingCash).toBeCloseTo(12.66);
    expect(p.cash).toBeCloseTo(250);
    expect(p.tickers.find((t) => t.ticker === 'SGOV')!.shares).toBe(20);
  });
});

describe('opening balances', () => {
  const text = csv([
    ['3/1/2024', 'XYZ', 'XYZ 3/15/2024 Put $45.00', 'BTC', '1', '$1.00', '($100.00)'],
    ['3/4/2024', 'XYZ', 'XYZ Corp', 'Sell', '100', '$50.00', '$5,000.00'],
  ]);

  it('flags missing history with a fix action', () => {
    const p = build(text);
    expect(p.warnings.map((w) => w.action).sort()).toEqual(['opening-option', 'opening-shares']);
    expect(p.warnings.every((w) => w.ticker === 'XYZ')).toBe(true);
  });

  it('uses opening cash, shares and options so nothing is missing', () => {
    const p = build(text, {
      opening: {
        asOf: null,
        cash: 2000,
        positions: [{ ticker: 'xyz', shares: 100, costPerShare: 40 }],
        options: [{ ticker: 'XYZ', type: 'Put', strike: 45, expiry: '2024-03-15', contracts: 1, premium: 150 }],
      },
    });
    const xyz = p.tickers[0];
    expect(p.warnings).toHaveLength(0);
    expect(xyz.realizedStock).toBeCloseTo(1000);
    expect(xyz.wheelPremium).toBeCloseTo(50);
    expect(p.cash).toBeCloseTo(2000 - 100 + 5000);
    expect(p.netDeposits).toBeCloseTo(6000);
    expect(p.openingCapital).toBeCloseTo(6000);
    expect(p.shortTrades[0]).toMatchObject({ opened: '2024-02-29', netPremium: 50, outcome: 'closed' });
    // Opening premium is not income for the month the export starts.
    expect(p.premiumByMonth).toEqual([{ month: '2024-03', premium: -100 }]);
  });
});
