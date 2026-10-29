import { describe, expect, it } from 'vitest';
import { blackScholes } from './options';
import { analyzeStrategy, type OptionLeg, type SharesLeg } from './strategy';

const leg = (o: Partial<OptionLeg>): OptionLeg => ({
  kind: 'option',
  id: Math.random().toString(),
  type: 'Put',
  side: 'short',
  strike: 40,
  contracts: 1,
  expiry: '2027-01-15',
  cash: 0,
  mark: null,
  iv: null,
  dte: 400,
  ...o,
});

describe('analyzeStrategy', () => {
  // 2 short $40 puts for $5.00 (+$1,000), 1 long $60 call for $8.00 (−$800), same expiry.
  // P/L at expiry = 200 − 200·max(40 − S, 0) + 100·max(S − 60, 0).
  const puts = leg({ contracts: 2, cash: 1000, mark: 4, iv: 0.5 });
  const call = leg({ type: 'Call', side: 'long', strike: 60, cash: -800, mark: 9, iv: 0.5 });

  it('two short puts financing a long call', () => {
    const a = analyzeStrategy([puts, call], 50);
    expect(a.netPremium).toBe(200);
    // Puts: 1000 − 4·200 = 200; call: 9·100 − 800 = 100.
    expect(a.unrealizedPL).toBeCloseTo(300, 6);
    expect(a.maxProfit).toBeNull(); // long call: unlimited
    expect(a.maxLoss).toBeCloseTo(7800, 6); // stock at $0: 200 − 8000
    expect(a.maxLossAt).toBe(0);
    expect(a.breakevens).toEqual([39]);
    expect(a.collateral).toBe(8000);
    expect(a.nakedCalls).toBe(0);
    const at = (move: number) => a.scenarios.find((s) => s.move === move)!.pl;
    expect(at(0)).toBeCloseTo(200, 6); // $50
    expect(at(0.3)).toBeCloseTo(700, 6); // $65: 200 + 500
    expect(at(-0.3)).toBeCloseTo(-800, 6); // $35: 200 − 1000
    expect(a.delta).not.toBeNull();
    expect(a.probProfit).toBeGreaterThan(0);
    expect(a.curve.every((p) => p.today != null)).toBe(true);
  });

  it('covered call: shares at basis plus the short call', () => {
    const shares: SharesLeg = { kind: 'shares', id: 's', shares: 100, basis: 45 };
    const cc = leg({ type: 'Call', strike: 50, cash: 200 });
    const a = analyzeStrategy([shares, cc], 48);
    expect(a.maxProfit).toBeCloseTo(700, 6); // (50 − 45)·100 + 200
    expect(a.maxLoss).toBeCloseTo(4300, 6); // 4500 − 200
    expect(a.breakevens).toEqual([43]);
    expect(a.nakedCalls).toBe(0);
    expect(a.unrealizedPL).toBeNull(); // the call has no mark
    expect(a.delta).toBeNull(); // no IV
  });

  it('a naked short call has unlimited loss', () => {
    const a = analyzeStrategy([leg({ type: 'Call', strike: 50, cash: 200 })], 48);
    expect(a.maxLoss).toBeNull();
    expect(a.maxProfit).toBeCloseTo(200, 6);
    expect(a.nakedCalls).toBe(1);
  });

  it('values later expiries with Black–Scholes at the first expiry', () => {
    const near = leg({ strike: 40, cash: 300, dte: 30, expiry: '2026-11-27', iv: 0.4 });
    const far = leg({ type: 'Call', side: 'long', strike: 60, cash: -800, dte: 395, expiry: '2027-11-26', iv: 0.4 });
    const a = analyzeStrategy([near, far], 50);
    expect(a.horizonDte).toBe(30);
    expect(a.horizonDate).toBe('2026-11-27');
    expect(a.laterLegs).toBe(true);
    const p = a.curve.find((x) => x.price === 50)!;
    expect(p.horizon).toBeCloseTo(300 - 800 + blackScholes('Call', 50, 60, 365 / 365, 0.4) * 100, 6);
  });
});
