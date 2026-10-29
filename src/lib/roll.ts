// Rolling a short option: buy it back and sell another (new expiration and/or strike).
// The P/L figures here are option-only and measured from when the current contract was sold,
// so "hold" and "roll" compare on the same footing. Cost basis effects are simulated by the
// caller by adding the trades from rollTrades()/settleTrade() to the account and rebuilding.
import { lognormalExpectation } from '../engine/options';
import type { OpenOption, OptionType } from '../engine/types';
import type { ManualTrade } from '../parser/manual';

export interface RollInput {
  /** The short option being rolled (all of its contracts are bought back). */
  option: OpenOption;
  /** ISO date the roll happens (today). */
  date: string;
  /** Buyback price per share. */
  closePrice: number;
  closeFees: number;
  newExpiry: string;
  newStrike: number;
  /** Credit per share for the new contract. */
  newPremium: number;
  newContracts: number;
  openFees: number;
}

export interface Contract {
  ticker: string;
  type: OptionType;
  strike: number;
  expiry: string;
  contracts: number;
}

export interface RollScenario {
  contract: Contract | null;
  /** Cash in (+) or out (−) today. */
  cashToday: number;
  /** Option P/L since the current contract was sold, if everything left open expires worthless. */
  maxPL: number;
  /** Same, if the stock is at today's price at expiry. */
  plAtPrice: number | null;
  /** Stock price at expiry where the option P/L is zero. */
  breakeven: number | null;
  /** Days until the money is free again. */
  days: number;
  /** Model chance the option P/L is positive at expiry. */
  probProfit: number | null;
}

export interface RollComparison {
  close: RollScenario;
  hold: RollScenario;
  roll: RollScenario;
  /** New credit − buyback cost (fees included). */
  netCredit: number;
  /** netCredit ÷ new contract's strike value, per year of the time added. */
  annualizedNet: number | null;
}

const intrinsic = (type: OptionType, strike: number, s: number) => (type === 'Call' ? Math.max(s - strike, 0) : Math.max(strike - s, 0));
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const r2 = (n: number) => Math.round(n * 100) / 100;

export const currentContract = (o: OpenOption): Contract => ({ ticker: o.underlying, type: o.type, strike: o.strike, expiry: o.expiry, contracts: o.contracts });
export const newContract = (r: RollInput): Contract => ({ ticker: r.option.underlying, type: r.option.type, strike: r.newStrike, expiry: r.newExpiry, contracts: r.newContracts });

const id = () => Math.random().toString(36).slice(2, 10);

/** The buy-to-close and sell-to-open that make up the roll, as manual trades. */
export function rollTrades(r: RollInput): [ManualTrade, ManualTrade] {
  const o = r.option;
  const note = `Roll: $${o.strike} ${o.type} ${o.expiry} → $${r.newStrike} ${r.newExpiry}`;
  return [
    { id: id(), date: r.date, action: 'btc', ticker: o.underlying, quantity: o.contracts, price: r.closePrice, fees: r.closeFees, amount: 0, option: { type: o.type, strike: o.strike, expiry: o.expiry }, note },
    { id: id(), date: r.date, action: 'sto', ticker: o.underlying, quantity: r.newContracts, price: r.newPremium, fees: r.openFees, amount: 0, option: { type: o.type, strike: r.newStrike, expiry: r.newExpiry }, note },
  ];
}

/** What happens to a contract at expiration, as a manual trade dated on its expiry. */
export function settleTrade(c: Contract, outcome: 'expired' | 'assigned'): ManualTrade {
  return { id: id(), date: c.expiry, action: outcome, ticker: c.ticker, quantity: c.contracts, price: 0, fees: 0, amount: 0, option: { type: c.type, strike: c.strike, expiry: c.expiry } };
}

function scenario(c: Contract, sinceSold: number, cashToday: number, days: number, price: number | null, iv: number | null): RollScenario {
  const m = 100 * c.contracts;
  const pl = (s: number) => sinceSold - intrinsic(c.type, c.strike, s) * m;
  const breakeven = c.type === 'Put' ? c.strike - sinceSold / m : c.strike + sinceSold / m;
  return {
    contract: c,
    cashToday,
    maxPL: r2(sinceSold),
    plAtPrice: price != null ? r2(pl(price)) : null,
    breakeven: c.type === 'Put' && breakeven <= 0 ? null : breakeven,
    days,
    probProfit: price != null && iv != null && iv > 0 && days > 0 ? lognormalExpectation(price, iv, days / 365, pl).probPositive : null,
  };
}

/**
 * @param price underlying price now
 * @param ivHold / ivRoll implied volatility of the current / new contract
 */
export function compareRoll(r: RollInput, price: number | null, ivHold: number | null, ivRoll: number | null): RollComparison {
  const o = r.option;
  const credit = o.cash;
  const buyback = r.closePrice * 100 * o.contracts + r.closeFees;
  const newCredit = r.newPremium * 100 * r.newContracts - r.openFees;
  const netCredit = r2(newCredit - buyback);
  const holdDays = Math.max(daysBetween(r.date, o.expiry), 0);
  const rollDays = Math.max(daysBetween(r.date, r.newExpiry), 0);
  const added = rollDays - holdDays;
  const strikeValue = r.newStrike * 100 * r.newContracts;

  return {
    close: { contract: null, cashToday: -r2(buyback), maxPL: r2(credit - buyback), plAtPrice: r2(credit - buyback), breakeven: null, days: 0, probProfit: null },
    hold: scenario(currentContract(o), credit, 0, holdDays, price, ivHold),
    roll: scenario(newContract(r), credit - buyback + newCredit, netCredit, rollDays, price, ivRoll),
    netCredit,
    annualizedNet: added > 0 && strikeValue > 0 ? (netCredit / strikeValue) * (365 / added) : null,
  };
}

/** Option P/L at expiry across a price range, for the hold-vs-roll chart. */
export function rollCurve(cmp: RollComparison, price: number | null): { price: number; hold: number; roll: number }[] {
  const h = cmp.hold.contract!;
  const n = cmp.roll.contract!;
  const strikes = [h.strike, n.strike, price ?? h.strike];
  const lo = Math.max(0, Math.min(...strikes) * 0.7);
  const hi = Math.max(...strikes) * 1.3;
  const pts = new Set<number>([h.strike, n.strike]);
  for (let i = 0; i <= 80; i++) pts.add(lo + ((hi - lo) * i) / 80);
  return [...pts]
    .sort((a, b) => a - b)
    .map((s) => ({
      price: r2(s),
      hold: r2(cmp.hold.maxPL - intrinsic(h.type, h.strike, s) * 100 * h.contracts),
      roll: r2(cmp.roll.maxPL - intrinsic(n.type, n.strike, s) * 100 * n.contracts),
    }));
}
