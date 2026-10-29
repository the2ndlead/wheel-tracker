import { describe, expect, it } from 'vitest';
import { buildPortfolio } from '../engine/ledger';
import { parseRobinhoodCsv } from './robinhood';
import { manualToTransactions, validateManualTrade, withManualTrades, type ManualTrade } from './manual';

function csv(rows: string[][]): string {
  const header = '"Activity Date","Process Date","Settle Date","Instrument","Description","Trans Code","Quantity","Price","Amount"';
  const q = (r: string[]) => [r[0], r[0], r[0], ...r.slice(1)].map((c) => `"${c}"`).join(',');
  return [header, ...[...rows].reverse().map(q)].join('\n');
}

let n = 0;
const trade = (t: Partial<ManualTrade>): ManualTrade => ({ id: String(n++), date: '2024-01-02', action: 'buy', ticker: 'XYZ', quantity: 0, price: 0, fees: 0, amount: 0, ...t });
const put = (strike: number, expiry: string) => ({ type: 'Put' as const, strike, expiry });
const call = (strike: number, expiry: string) => ({ type: 'Call' as const, strike, expiry });
const opts = { today: '2024-06-01', opening: { asOf: null, cash: 10_000, positions: [], options: [] } };

describe('manual trades', () => {
  it('gives the same result as the same trades imported from a CSV', () => {
    const imported = parseRobinhoodCsv(
      csv([
        ['1/2/2024', 'XYZ', 'XYZ 1/19/2024 Put $50.00', 'STO', '1', '$1.50', '$150.00'],
        ['1/19/2024', 'XYZ', 'XYZ Corp', 'Buy', '100', '$50.00', '($5,000.00)'],
        ['1/19/2024', 'XYZ', 'XYZ 1/19/2024 Put $50.00', 'OASGN', '1', '', ''],
        ['1/22/2024', 'XYZ', 'XYZ 2/16/2024 Call $55.00', 'STO', '1', '$1.00', '$100.00'],
        ['2/1/2024', 'XYZ', 'XYZ 2/16/2024 Call $55.00', 'BTC', '1', '$0.30', '($30.00)'],
        ['2/9/2024', 'XYZ', 'Cash Div', 'CDIV', '', '', '$10.00'],
      ]),
    ).transactions;
    const manual = withManualTrades(
      [],
      [
        trade({ date: '2024-01-02', action: 'sto', quantity: 1, price: 1.5, option: put(50, '2024-01-19') }),
        trade({ date: '2024-01-19', action: 'assigned', quantity: 1, option: put(50, '2024-01-19') }),
        trade({ date: '2024-01-22', action: 'sto', quantity: 1, price: 1, option: call(55, '2024-02-16') }),
        trade({ date: '2024-02-01', action: 'btc', quantity: 1, price: 0.3, option: call(55, '2024-02-16') }),
        trade({ date: '2024-02-09', action: 'dividend', amount: 10 }),
      ],
    ).transactions;

    const a = buildPortfolio(imported, opts);
    const b = buildPortfolio(manual, opts);
    const pick = (p: typeof a) => {
      const t = p.tickers[0];
      return { cash: p.cash, shares: t.shares, avg: t.avgCost, premium: t.wheelPremium, dividends: t.dividends, basis: t.trueCostBasis, cycles: p.cycles.length };
    };
    expect(pick(b)).toEqual(pick(a));
    // 5000 − 150 − 70 net premium = 4780 → 47.80 per share
    expect(b.tickers[0].trueCostBasis).toBeCloseTo(47.8, 6);
    // The assignment's stock leg comes with the manual trade, so nothing is inferred.
    expect(b.warnings.filter((w) => w.text.includes('inferred'))).toEqual([]);
  });

  it('takes fees out of the cash amount', () => {
    expect(manualToTransactions(trade({ action: 'sto', quantity: 2, price: 1.25, fees: 0.08, option: put(20, '2024-02-16') }))[0].amount).toBe(249.92);
    expect(manualToTransactions(trade({ action: 'btc', quantity: 2, price: 0.1, fees: 0.08, option: put(20, '2024-02-16') }))[0].amount).toBe(-20.08);
    expect(manualToTransactions(trade({ action: 'buy', quantity: 10, price: 12.345 }))[0].amount).toBe(-123.45);
    expect(manualToTransactions(trade({ action: 'withdrawal', ticker: '', amount: 500 }))[0]).toMatchObject({ code: 'ACH', amount: -500, instrument: '' });
  });

  it('sells the shares when a covered call is assigned', () => {
    const rows = manualToTransactions(trade({ action: 'assigned', quantity: 2, option: call(55, '2024-02-16') }));
    expect(rows.map((r) => [r.code, r.quantity, r.amount])).toEqual([
      ['OASGN', 2, 0],
      ['Sell', 200, 11_000],
    ]);
  });

  it('closes an imported contract and flags a manual trade that the import already has', () => {
    const imported = parseRobinhoodCsv(csv([['3/1/2024', 'ABC', 'ABC 3/15/2024 Put $10.00', 'STO', '1', '$0.50', '$50.00']])).transactions;
    const sto = trade({ date: '2024-03-01', ticker: 'abc', action: 'sto', quantity: 1, price: 0.5, option: put(10, '2024-03-15') });
    const btc = trade({ date: '2024-03-05', ticker: 'ABC', action: 'btc', quantity: 1, price: 0.1, option: put(10, '2024-03-15') });

    const closed = withManualTrades(imported, [btc]);
    expect(closed.warnings).toEqual([]);
    const p = buildPortfolio(closed.transactions, opts);
    expect(p.openOptions).toEqual([]);
    expect(p.tickers[0].wheelPremium).toBe(40);

    const dup = withManualTrades(imported, [sto]);
    expect(dup.warnings).toHaveLength(1);
    expect(dup.warnings[0].text).toContain('counted twice');
  });

  it('puts manual trades after imported rows on the same day', () => {
    const imported = parseRobinhoodCsv(csv([['3/1/2024', 'ABC', 'ABC Inc', 'Buy', '100', '$10.00', '($1,000.00)']])).transactions;
    const r = withManualTrades(imported, [trade({ date: '2024-03-01', ticker: 'ABC', action: 'sell', quantity: 100, price: 11 })]);
    expect(r.transactions.map((t) => [t.id, t.code, !!t.manual])).toEqual([
      [0, 'Buy', false],
      [1, 'Sell', true],
    ]);
  });

  it('validates what each action needs', () => {
    expect(validateManualTrade(trade({ action: 'buy', quantity: 10, price: 5 }))).toBeNull();
    expect(validateManualTrade(trade({ action: 'buy', quantity: 10 }))).toMatch(/price/);
    expect(validateManualTrade(trade({ action: 'sto', quantity: 1, price: 1 }))).toMatch(/strike/);
    expect(validateManualTrade(trade({ action: 'expired', quantity: 1, option: put(10, '2024-03-15') }))).toBeNull();
    expect(validateManualTrade(trade({ action: 'deposit', ticker: '', amount: 0 }))).toMatch(/amount/);
    expect(validateManualTrade(trade({ action: 'dividend', ticker: '', amount: 5 }))).toMatch(/ticker/);
  });
});
