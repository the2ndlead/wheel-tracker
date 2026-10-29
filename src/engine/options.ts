import type { OpenOption } from './types';

export interface AnalyzeInput {
  option: OpenOption;
  /** Current underlying price. */
  price: number | null;
  /** Current option price per share (mark). */
  mark: number | null;
  /** Implied volatility, decimal. */
  iv: number | null;
  /** Shares of the underlying held, used to treat a short call as covered. */
  sharesHeld: number;
  /** True cost basis per share of those shares. */
  trueBasis: number | null;
  /** Whether this contract's premium is already subtracted in trueBasis (false in realized-only mode). */
  premiumInBasis: boolean;
  /** Days to expiry. */
  dte: number;
}

export interface PayoffPoint {
  price: number;
  /** P/L at expiry of the option alone (premium included). */
  option: number;
  /** For covered calls: shares vs true basis + the short call. */
  position?: number;
}

export interface OptionAnalysis {
  multiplier: number;
  /** Premium received (short) or paid (long), positive. */
  premium: number;
  /** What the contracts are worth now (mark × multiplier); null without a mark. */
  contractValue: number | null;
  unrealizedPL: number | null;
  /** Unrealized P/L as a share of premium. */
  unrealizedPct: number | null;
  /** null = unlimited. */
  maxProfit: number | null;
  /** null = unlimited. */
  maxRisk: number | null;
  /** Short options: share of the premium already earned. */
  maxProfitCaptured: number | null;
  /** Current loss as a share of max risk (0 when in profit). */
  riskUsed: number | null;
  breakeven: number;
  covered: boolean;
  /** Model estimate (lognormal, zero drift) of total P/L at expiry; null without IV or price. */
  expectedPL: number | null;
  /** Model probability the position is profitable at expiry. */
  probProfit: number | null;
  curve: PayoffPoint[];
}

const intrinsic = (type: OpenOption['type'], strike: number, s: number) => (type === 'Call' ? Math.max(s - strike, 0) : Math.max(strike - s, 0));

export function analyzeOption(input: AnalyzeInput): OptionAnalysis {
  const { option: o, price, mark, iv, dte } = input;
  const m = 100 * o.contracts;
  const premium = Math.abs(o.cash);
  const short = o.side === 'short';
  const perShare = premium / m;
  const coveredShares = short && o.type === 'Call' && input.trueBasis != null ? Math.min(input.sharesHeld, m) : 0;
  const covered = coveredShares >= m;

  const optionPL = (s: number) => (short ? premium - intrinsic(o.type, o.strike, s) * m : intrinsic(o.type, o.strike, s) * m - premium);
  // Premium is already inside the true basis, so the position view only adds the stock leg.
  // Premium already inside the true basis must not be added again; otherwise add it here.
  const extra = input.premiumInBasis ? 0 : premium;
  const positionPL = covered ? (s: number) => (s - input.trueBasis!) * coveredShares + extra - intrinsic(o.type, o.strike, s) * m : null;

  const contractValue = mark != null ? mark * m : null;
  const unrealizedPL = contractValue == null ? null : short ? premium - contractValue : contractValue - premium;

  let maxProfit: number | null;
  let maxRisk: number | null;
  if (short && o.type === 'Put') {
    maxProfit = premium;
    maxRisk = o.strike * m - premium;
  } else if (short) {
    maxProfit = covered ? (o.strike - input.trueBasis!) * coveredShares + extra : premium;
    maxRisk = covered ? input.trueBasis! * coveredShares - extra : null;
  } else if (o.type === 'Call') {
    maxProfit = null;
    maxRisk = premium;
  } else {
    maxProfit = o.strike * m - premium;
    maxRisk = premium;
  }

  // For a covered call, risk is about the whole position (shares vs true basis + the call).
  const riskUsed = () => {
    if (unrealizedPL == null || !maxRisk) return null;
    // Position now: shares vs true basis, plus premium not in the basis, minus what buying the call back costs.
    const pl = covered && price != null ? (price - input.trueBasis!) * coveredShares + extra - (premium - unrealizedPL) : unrealizedPL;
    return Math.max(0, -pl) / maxRisk;
  };

  const breakeven = o.type === 'Put' ? o.strike - perShare : o.strike + perShare;

  // Payoff curve from 50% below to 50% above the strike/current price.
  const anchor = price ?? o.strike;
  const lo = Math.max(0, Math.min(anchor, o.strike) * 0.5);
  const hi = Math.max(anchor, o.strike) * 1.5;
  const points = new Set<number>();
  for (let i = 0; i <= 80; i++) points.add(round2(lo + ((hi - lo) * i) / 80));
  [o.strike, breakeven, price ?? o.strike].forEach((p) => points.add(round2(p)));
  if (covered) points.add(round2(input.trueBasis!));
  const curve = [...points]
    .filter((p) => p >= 0)
    .sort((a, b) => a - b)
    .map((s) => ({ price: s, option: optionPL(s), ...(positionPL ? { position: positionPL(s) } : {}) }));

  let expectedPL: number | null = null;
  let probProfit: number | null = null;
  if (price != null && iv != null && iv > 0 && dte > 0) {
    const pl = positionPL ?? optionPL;
    const e = lognormalExpectation(price, iv, dte / 365, pl);
    expectedPL = e.mean;
    probProfit = e.probPositive;
  }

  return {
    multiplier: m,
    premium,
    contractValue,
    unrealizedPL,
    unrealizedPct: unrealizedPL != null && premium > 0 ? unrealizedPL / premium : null,
    maxProfit,
    maxRisk,
    maxProfitCaptured: short && unrealizedPL != null && premium > 0 ? unrealizedPL / premium : null,
    riskUsed: riskUsed(),
    breakeven,
    covered,
    expectedPL,
    probProfit,
    curve,
  };
}

/**
 * E[f(S_T)] and P(f(S_T) > 0) for S_T = S·exp(−σ²T/2 + σ√T·Z), Z ~ N(0,1),
 * by numeric integration over Z in [−6, 6].
 */
export function lognormalExpectation(s: number, sigma: number, t: number, f: (s: number) => number) {
  const steps = 2400;
  const dz = 12 / steps;
  const sd = sigma * Math.sqrt(t);
  let mean = 0;
  let probPositive = 0;
  let weight = 0;
  for (let i = 0; i <= steps; i++) {
    const z = -6 + i * dz;
    const w = (Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI)) * dz * (i === 0 || i === steps ? 0.5 : 1);
    const v = f(s * Math.exp(-0.5 * sd * sd + sd * z));
    mean += v * w;
    if (v > 0) probPositive += w;
    weight += w;
  }
  return { mean: mean / weight, probPositive: probPositive / weight };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const normCdf = (x: number) => {
  // Abramowitz–Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
};

/** Black–Scholes price per share with zero rates (matches the zero-drift model above). */
export function blackScholes(type: OpenOption['type'], s: number, k: number, t: number, sigma: number): number {
  if (t <= 0 || sigma <= 0) return intrinsic(type, k, s);
  const sd = sigma * Math.sqrt(t);
  const d1 = (Math.log(s / k) + 0.5 * sd * sd) / sd;
  const d2 = d1 - sd;
  return type === 'Call' ? s * normCdf(d1) - k * normCdf(d2) : k * normCdf(-d2) - s * normCdf(-d1);
}

/**
 * Volatility implied by an option price (bisection). Yahoo's own IV field is unreliable
 * outside market hours, so the app derives IV from the mark it actually uses.
 */
export function impliedVol(type: OpenOption['type'], price: number, s: number, k: number, t: number): number | null {
  if (!(price > 0) || !(s > 0) || !(t > 0) || price <= intrinsic(type, k, s) + 1e-4) return null;
  let lo = 0.005;
  let hi = 5;
  if (blackScholes(type, s, k, t, hi) < price) return null;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (blackScholes(type, s, k, t, mid) > price) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}
