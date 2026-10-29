// Several positions on one ticker analyzed as one strategy (e.g. two short puts + a long call).
import { blackScholes, lognormalExpectation } from './options';
import type { OptionType } from './types';

export interface OptionLeg {
  kind: 'option';
  id: string;
  type: OptionType;
  side: 'short' | 'long';
  strike: number;
  contracts: number;
  expiry: string;
  /** Net cash at open: positive = premium received (short), negative = paid (long). */
  cash: number;
  /** Option price per share now. */
  mark: number | null;
  /** Implied volatility, decimal. */
  iv: number | null;
  dte: number;
}

export interface SharesLeg {
  kind: 'shares';
  id: string;
  shares: number;
  /** Cost per share the shares are measured from (true basis without open premium). */
  basis: number;
}

export type StrategyLeg = OptionLeg | SharesLeg;

export interface StrategyPoint {
  price: number;
  /** P/L at the horizon (the first expiry). */
  horizon: number;
  /** Model P/L today (Black–Scholes); absent when an option has no IV. */
  today?: number;
}

export interface Scenario {
  move: number;
  price: number;
  pl: number;
}

export interface StrategyAnalysis {
  /** Premium received minus premium paid when the options were opened. */
  netPremium: number;
  /** P/L now: options at mark, shares at the current price; null when something has no quote. */
  unrealizedPL: number | null;
  /** Days until the first option expires (0 for shares only). */
  horizonDte: number;
  horizonDate: string | null;
  /** Some options expire after the horizon; they're valued with Black–Scholes there. */
  laterLegs: boolean;
  /** null = unlimited. */
  maxProfit: number | null;
  /** Positive number; null = unlimited. */
  maxLoss: number | null;
  /** Stock price where the max loss happens (finite only). */
  maxLossAt: number | null;
  breakevens: number[];
  /** Cash needed to secure short puts (strike × 100 × contracts). */
  collateral: number;
  /** Short calls not covered by shares in the selection, in contracts. */
  nakedCalls: number;
  /** Net delta in shares (positive = gains when the stock rises); null without IVs. */
  delta: number | null;
  /** Volatility the probability model uses (contract-weighted average IV). */
  iv: number | null;
  expectedPL: number | null;
  probProfit: number | null;
  scenarios: Scenario[];
  curve: StrategyPoint[];
}

const intrinsic = (type: OptionType, strike: number, s: number) => (type === 'Call' ? Math.max(s - strike, 0) : Math.max(strike - s, 0));

const normCdf = (x: number) => {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const MOVES = [-0.5, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.5];

export function analyzeStrategy(legs: StrategyLeg[], price: number | null): StrategyAnalysis {
  const options = legs.filter((l): l is OptionLeg => l.kind === 'option');
  const shares = legs.filter((l): l is SharesLeg => l.kind === 'shares');
  const live = options.filter((o) => o.dte >= 0);
  const horizonDte = live.length ? Math.min(...live.map((o) => o.dte)) : 0;
  const horizonDate = live.length ? live.reduce((a, o) => (o.expiry < a ? o.expiry : a), live[0].expiry) : null;
  const laterLegs = live.some((o) => o.dte > horizonDte);

  const withIv = options.filter((o) => o.iv != null && o.iv > 0);
  const weight = withIv.reduce((s, o) => s + o.contracts, 0);
  const iv = weight ? withIv.reduce((s, o) => s + o.iv! * o.contracts, 0) / weight : null;
  // An option without its own IV borrows the average, so later legs still get time value.
  const sigma = (o: OptionLeg) => (o.iv != null && o.iv > 0 ? o.iv : iv);

  const sign = (o: OptionLeg) => (o.side === 'long' ? 1 : -1);
  const optionValue = (o: OptionLeg, s: number, days: number) => {
    const v = sigma(o);
    return days > 0 && v != null ? blackScholes(o.type, s, o.strike, days / 365, v) : intrinsic(o.type, o.strike, s);
  };
  const atHorizon = (s: number) =>
    options.reduce((sum, o) => sum + o.cash + sign(o) * optionValue(o, s, o.dte - horizonDte) * 100 * o.contracts, 0) +
    shares.reduce((sum, l) => sum + (s - l.basis) * l.shares, 0);
  const todayOk = options.every((o) => o.dte <= 0 || sigma(o) != null);
  const today = (s: number) =>
    options.reduce((sum, o) => sum + o.cash + sign(o) * optionValue(o, s, o.dte) * 100 * o.contracts, 0) + shares.reduce((sum, l) => sum + (s - l.basis) * l.shares, 0);

  const netPremium = options.reduce((s, o) => s + o.cash, 0);
  const unrealizedPL =
    options.some((o) => o.mark == null) || (shares.length && price == null)
      ? null
      : options.reduce((s, o) => s + o.cash + sign(o) * o.mark! * 100 * o.contracts, 0) + shares.reduce((s, l) => s + (price! - l.basis) * l.shares, 0);

  const strikes = options.map((o) => o.strike);
  const bases = shares.map((l) => l.basis);
  const anchors = [...strikes, ...bases, ...(price != null ? [price] : [])];
  const top = anchors.length ? Math.max(...anchors) : 1;

  // Far right the P/L grows by this many dollars per $1 of stock (calls and shares).
  const sharesHeld = shares.reduce((s, l) => s + l.shares, 0);
  const callShares = options.filter((o) => o.type === 'Call').reduce((s, o) => s + sign(o) * 100 * o.contracts, 0);
  const tailSlope = sharesHeld + callShares;

  // Dense scan from $0 to well past every strike; the extremes are at kinks or the ends.
  const scan = new Set<number>([0, ...anchors.map(round2)]);
  const scanTop = top * 4;
  for (let i = 0; i <= 800; i++) scan.add(round2((scanTop * i) / 800));
  const grid = [...scan].sort((a, b) => a - b).map((s) => ({ s, pl: atHorizon(s) }));
  const pls = grid.map((p) => p.pl);
  const maxProfit = tailSlope > 1e-9 ? null : Math.max(...pls);
  const minPL = Math.min(...pls);
  const maxLoss = tailSlope < -1e-9 ? null : Math.max(0, -minPL);
  const maxLossAt = maxLoss == null ? null : grid.find((p) => p.pl === minPL)!.s;

  const breakevens: number[] = [];
  for (let i = 1; i < grid.length; i++) {
    const a = grid[i - 1];
    const b = grid[i];
    if ((a.pl < 0 && b.pl >= 0) || (a.pl >= 0 && b.pl < 0)) {
      const x = a.s + ((b.s - a.s) * -a.pl) / (b.pl - a.pl);
      if (!breakevens.length || Math.abs(x - breakevens[breakevens.length - 1]) > 0.01) breakevens.push(round2(x));
    }
  }

  const collateral = options.filter((o) => o.side === 'short' && o.type === 'Put').reduce((s, o) => s + o.strike * 100 * o.contracts, 0);
  const shortCalls = options.filter((o) => o.side === 'short' && o.type === 'Call').reduce((s, o) => s + o.contracts, 0);
  const longCalls = options.filter((o) => o.side === 'long' && o.type === 'Call').reduce((s, o) => s + o.contracts, 0);
  const nakedCalls = Math.max(0, shortCalls - longCalls - Math.floor(sharesHeld / 100));

  let delta: number | null = null;
  if (price != null && options.every((o) => o.dte <= 0 || sigma(o) != null)) {
    delta = sharesHeld;
    for (const o of options) {
      let d: number;
      if (o.dte <= 0) d = o.type === 'Call' ? (price > o.strike ? 1 : 0) : price < o.strike ? -1 : 0;
      else {
        const sd = sigma(o)! * Math.sqrt(o.dte / 365);
        const n1 = normCdf((Math.log(price / o.strike) + 0.5 * sd * sd) / sd);
        d = o.type === 'Call' ? n1 : n1 - 1;
      }
      delta += sign(o) * d * 100 * o.contracts;
    }
  }

  let expectedPL: number | null = null;
  let probProfit: number | null = null;
  if (price != null && iv != null && horizonDte > 0) {
    const e = lognormalExpectation(price, iv, horizonDte / 365, atHorizon);
    expectedPL = e.mean;
    probProfit = e.probPositive;
  }

  // Chart range: half the lowest anchor to 1.5× the highest.
  const lo = anchors.length ? Math.min(...anchors) * 0.5 : 0;
  const hi = top * 1.5;
  const pts = new Set<number>([...anchors, ...breakevens].map(round2));
  for (let i = 0; i <= 120; i++) pts.add(round2(lo + ((hi - lo) * i) / 120));
  const curve = [...pts]
    .filter((s) => s >= lo && s <= hi)
    .sort((a, b) => a - b)
    .map((s) => ({ price: s, horizon: atHorizon(s), ...(todayOk && options.some((o) => o.dte > 0) ? { today: today(s) } : {}) }));

  const scenarios = price == null ? [] : MOVES.map((move) => ({ move, price: price * (1 + move), pl: atHorizon(price * (1 + move)) }));

  return {
    netPremium,
    unrealizedPL,
    horizonDte,
    horizonDate,
    laterLegs,
    maxProfit,
    maxLoss,
    maxLossAt,
    breakevens,
    collateral,
    nakedCalls,
    delta,
    iv,
    expectedPL,
    probProfit,
    scenarios,
    curve,
  };
}
