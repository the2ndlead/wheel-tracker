import { describe, expect, it } from 'vitest';
import { analyzeOption, lognormalExpectation } from './options';
import type { OpenOption } from './types';

const opt = (o: Partial<OpenOption>): OpenOption => ({
  key: 'k',
  underlying: 'XYZ',
  expiry: '2026-12-18',
  type: 'Put',
  strike: 50,
  side: 'short',
  contracts: 1,
  cash: 200,
  opened: '2026-10-01',
  ...o,
});

describe('analyzeOption', () => {
  it('short put: premium, max risk, breakeven, captured profit', () => {
    const a = analyzeOption({ option: opt({}), price: 55, mark: 0.5, iv: null, sharesHeld: 0, trueBasis: null, premiumInBasis: false, dte: 30 });
    expect(a.premium).toBe(200);
    expect(a.contractValue).toBeCloseTo(50);
    expect(a.unrealizedPL).toBeCloseTo(150);
    expect(a.maxProfit).toBe(200);
    expect(a.maxRisk).toBe(4800);
    expect(a.maxProfitCaptured).toBeCloseTo(0.75);
    expect(a.riskUsed).toBe(0);
    expect(a.breakeven).toBeCloseTo(48);
    expect(a.curve.find((p) => p.price === 48)!.option).toBeCloseTo(0);
    expect(a.curve.find((p) => p.price === 50)!.option).toBeCloseTo(200);
  });

  it('short put in the red reports share of max risk used', () => {
    const a = analyzeOption({ option: opt({}), price: 40, mark: 10.5, iv: null, sharesHeld: 0, trueBasis: null, premiumInBasis: false, dte: 30 });
    expect(a.unrealizedPL).toBeCloseTo(-850);
    expect(a.riskUsed).toBeCloseTo(850 / 4800);
  });

  it('covered call uses shares at true basis for the position view', () => {
    const a = analyzeOption({
      option: opt({ type: 'Call', strike: 110, cash: 300 }),
      price: 100,
      mark: 1,
      iv: null,
      sharesHeld: 100,
      trueBasis: 95,
      premiumInBasis: true,
      dte: 20,
    });
    expect(a.covered).toBe(true);
    expect(a.maxProfit).toBeCloseTo((110 - 95) * 100);
    expect(a.maxRisk).toBeCloseTo(9500);
    expect(a.breakeven).toBeCloseTo(113);
    // At the strike the call expires worthless: shares gained 110 − 95.
    expect(a.curve.find((p) => p.price === 110)!.position).toBeCloseTo((110 - 95) * 100);
    expect(a.curve[a.curve.length - 1].position).toBeCloseTo(a.maxProfit!);
  });

  it('covered call with realized-only basis adds the premium once', () => {
    // Basis excludes this call's $300, so the position view adds it back.
    const a = analyzeOption({
      option: opt({ type: 'Call', strike: 110, cash: 300 }),
      price: 100,
      mark: 1,
      iv: null,
      sharesHeld: 100,
      trueBasis: 98,
      premiumInBasis: false,
      dte: 20,
    });
    expect(a.maxProfit).toBeCloseTo((110 - 98) * 100 + 300);
    expect(a.maxRisk).toBeCloseTo(9800 - 300);
    expect(a.curve.find((p) => p.price === 110)!.position).toBeCloseTo((110 - 98) * 100 + 300);
    // Now: shares +200, premium 300 kept, call costs 100 to buy back → +400, no risk used.
    expect(a.riskUsed).toBe(0);
  });

  it('uncovered short call has unlimited risk; long call unlimited profit', () => {
    expect(analyzeOption({ option: opt({ type: 'Call' }), price: 50, mark: 1, iv: null, sharesHeld: 0, trueBasis: null, premiumInBasis: false, dte: 5 }).maxRisk).toBeNull();
    const long = analyzeOption({ option: opt({ type: 'Call', side: 'long', cash: -500 }), price: 50, mark: 7, iv: null, sharesHeld: 0, trueBasis: null, premiumInBasis: false, dte: 5 });
    expect(long.maxProfit).toBeNull();
    expect(long.maxRisk).toBe(500);
    expect(long.unrealizedPL).toBeCloseTo(200);
  });

  it('gives a model expected P/L and probability of profit when IV is known', () => {
    const a = analyzeOption({ option: opt({}), price: 55, mark: 1, iv: 0.4, sharesHeld: 0, trueBasis: null, premiumInBasis: false, dte: 30 });
    expect(a.probProfit!).toBeGreaterThan(0.5);
    expect(a.probProfit!).toBeLessThan(1);
    expect(a.expectedPL!).toBeLessThan(200);
  });
});

describe('lognormalExpectation', () => {
  it('has the right mean for the underlying itself (zero drift)', () => {
    expect(lognormalExpectation(100, 0.5, 1, (s) => s).mean).toBeCloseTo(100, 1);
  });
  it('gives ~50% for a call at the money-ish median', () => {
    const { probPositive } = lognormalExpectation(100, 0.3, 0.5, (s) => s - 100 * Math.exp((-0.5 * 0.3 * 0.3 * 0.5)));
    expect(probPositive).toBeCloseTo(0.5, 2);
  });
});

describe('impliedVol', () => {
  it('round-trips through Black–Scholes', async () => {
    const { blackScholes, impliedVol } = await import('./options');
    const price = blackScholes('Call', 100, 110, 0.25, 0.55);
    expect(impliedVol('Call', price, 100, 110, 0.25)!).toBeCloseTo(0.55, 3);
    const put = blackScholes('Put', 100, 90, 0.1, 0.3);
    expect(impliedVol('Put', put, 100, 90, 0.1)!).toBeCloseTo(0.3, 3);
    expect(impliedVol('Call', 0.01, 100, 110, 0.25)).not.toBeNull();
    expect(impliedVol('Put', 5, 100, 110, 0.25)).toBeNull(); // below intrinsic
  });
});
