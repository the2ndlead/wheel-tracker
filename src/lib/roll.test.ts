import { describe, expect, it } from 'vitest';
import { DEFAULT_BASIS, EMPTY_OPENING, type OpenOption } from '../engine/types';
import { mergeCsvFiles } from '../parser/merge';
import { compareRoll, newContract, rollTrades, settleTrade, currentContract, type RollInput } from './roll';
import { buildFromSources, ownerOf, type AccountSource } from './sources';

function csv(rows: string[][]): string {
  const header = '"Activity Date","Process Date","Settle Date","Instrument","Description","Trans Code","Quantity","Price","Amount"';
  const q = (r: string[]) => [r[0], r[0], r[0], ...r.slice(1)].map((c) => `"${c}"`).join(',');
  return [header, ...[...rows].reverse().map(q)].join('\n');
}
const source = (rows: string[][], id = 'a', name = 'IRA'): AccountSource => ({
  id,
  name,
  csv: mergeCsvFiles([{ name: 'r.csv', text: csv(rows) }]),
  manual: [],
  opening: { ...EMPTY_OPENING, cash: 10_000 },
});
const realized = DEFAULT_BASIS;
const withOpen = { ...DEFAULT_BASIS, realizedOnly: false };

const putRows = [['1/2/2024', 'XYZ', 'XYZ 2/16/2024 Put $50.00', 'STO', '1', '$1.50', '$150.00']];
const put = (): OpenOption => buildFromSources([source(putRows)], false, realized)!.portfolio.openOptions[0];
// Buy the $50 put back for $2.00, sell the March $48 put for $2.50.
const putRoll = (): RollInput => ({ option: put(), date: '2024-02-01', closePrice: 2, closeFees: 0, newExpiry: '2024-03-15', newStrike: 48, newPremium: 2.5, newContracts: 1, openFees: 0 });

describe('compareRoll', () => {
  it('compares closing, keeping and rolling a put', () => {
    const c = compareRoll(putRoll(), 49, null, null);
    expect(c.netCredit).toBe(50);
    expect(c.close).toMatchObject({ cashToday: -200, maxPL: -50 });
    // Keep: $150 credit; at $49 the put is $1 ITM → 150 − 100 = 50.
    expect(c.hold).toMatchObject({ cashToday: 0, maxPL: 150, plAtPrice: 50, breakeven: 48.5, days: 15 });
    // Roll: 150 − 200 + 250 = 200; $48 strike is OTM at $49.
    expect(c.roll).toMatchObject({ cashToday: 50, maxPL: 200, plAtPrice: 200, breakeven: 46, days: 43 });
    expect(c.annualizedNet).toBeCloseTo((50 / 4800) * (365 / 28), 10);
  });

  it('includes fees and gives a model chance of profit when IV is known', () => {
    const c = compareRoll({ ...putRoll(), closeFees: 0.04, openFees: 0.04 }, 49, 0.5, 0.5);
    expect(c.netCredit).toBe(49.92);
    expect(c.roll.probProfit).toBeGreaterThan(c.hold.probProfit!);
  });

  it('builds the roll as a buy to close and a sell to open', () => {
    const [btc, sto] = rollTrades(putRoll());
    expect([btc.action, btc.quantity, btc.price, btc.option]).toEqual(['btc', 1, 2, { type: 'Put', strike: 50, expiry: '2024-02-16' }]);
    expect([sto.action, sto.quantity, sto.price, sto.option]).toEqual(['sto', 1, 2.5, { type: 'Put', strike: 48, expiry: '2024-03-15' }]);
  });
});

describe('cost basis after a roll (simulated through the engine)', () => {
  it('put: basis if assigned after rolling down', () => {
    const s = [source(putRows)];
    const sim = (trades: ReturnType<typeof rollTrades>[number][]) =>
      buildFromSources(s, false, realized, { accountId: 'a', trades })!.portfolio.tickers.find((t) => t.ticker === 'XYZ')!;
    const r = putRoll();
    // Keep and get assigned at $50: 5000 − 150 = 4850 → $48.50
    expect(sim([settleTrade(currentContract(r.option), 'assigned')]).trueCostBasis).toBeCloseTo(48.5, 6);
    // Roll then get assigned at $48: 4800 − (150 − 200 + 250) = 4600 → $46.00
    const rolled = sim([...rollTrades(r), settleTrade(newContract(r), 'assigned')]);
    expect(rolled.trueCostBasis).toBeCloseTo(46, 6);
    expect(rolled.shares).toBe(100);
    // The planned trades are never saved: the source is untouched.
    expect(s[0].manual).toEqual([]);
  });

  it('covered call: basis right after the roll, if it expires, and gain if called away', () => {
    const rows = [
      ['1/2/2024', 'XYZ', 'XYZ Corp', 'Buy', '100', '$50.00', '($5,000.00)'],
      ['1/3/2024', 'XYZ', 'XYZ 2/16/2024 Call $55.00', 'STO', '1', '$1.00', '$100.00'],
    ];
    const s = [source(rows)];
    const call = buildFromSources(s, false, realized)!.portfolio.openOptions[0];
    const r: RollInput = { option: call, date: '2024-02-01', closePrice: 0.4, closeFees: 0, newExpiry: '2024-03-15', newStrike: 55, newPremium: 1.2, newContracts: 1, openFees: 0 };
    const pos = (trades: ReturnType<typeof rollTrades>[number][], b = realized) =>
      buildFromSources(s, false, b, { accountId: 'a', trades })!.portfolio.tickers.find((t) => t.ticker === 'XYZ')!;

    // Realized only: the old call's 100 − 40 counts, the new 120 is still open → 4940 / 100.
    expect(pos(rollTrades(r)).trueCostBasis).toBeCloseTo(49.4, 6);
    // Including open premium, or once the new call expires: 5000 − 60 − 120 = 4820.
    expect(pos(rollTrades(r), withOpen).trueCostBasis).toBeCloseTo(48.2, 6);
    expect(pos([...rollTrades(r), settleTrade(newContract(r), 'expired')]).trueCostBasis).toBeCloseTo(48.2, 6);
    // Called away at $55: stock +500, premium 60 + 120.
    const called = pos([...rollTrades(r), settleTrade(newContract(r), 'assigned')]);
    expect(called.shares).toBe(0);
    expect(called.cycles[called.cycles.length - 1].totalReturn).toBeCloseTo(680, 6);
  });

  it('combined view: rolls in the account that holds the contract', () => {
    const a = source(putRows, 'a', 'IRA');
    const b = source([['1/2/2024', 'XYZ', 'XYZ Corp', 'Buy', '100', '$40.00', '($4,000.00)']], 'b', 'Individual');
    const p = buildFromSources([a, b], true, realized)!.portfolio;
    const o = p.openOptions[0];
    expect(ownerOf([a, b], true, o.key)?.id).toBe('a');
    const r: RollInput = { ...putRoll(), option: o };
    const after = buildFromSources([a, b], true, realized, { accountId: 'a', trades: [...rollTrades(r), settleTrade(newContract(r), 'assigned')] })!.portfolio;
    const xyz = after.tickers.find((t) => t.ticker === 'XYZ')!;
    // IRA: 4800 − 200 premium; Individual: 4000 → (4600 + 4000) / 200
    expect(xyz.shares).toBe(200);
    expect(xyz.trueCostBasis).toBeCloseTo(43, 6);
  });
});
