// Live-price rows derived from the engine output (engine/ stays price-free).
import { contractKey, daysToExpiry } from '../engine/ledger';
import { analyzeOption, impliedVol, type OptionAnalysis } from '../engine/options';
import type { OpenOption, Portfolio, TickerPosition } from '../engine/types';
import type { OptionQuote, Quote } from '../prices/yahoo';

export interface PositionRow extends TickerPosition {
  price: number | null;
  priceSource: 'yahoo' | 'manual' | null;
  dayChangePct: number | null;
  marketValue: number | null;
  plTrue: number | null;
  plTruePct: number | null;
  plBroker: number | null;
  plBrokerPct: number | null;
}

export interface OptionRow extends OpenOption {
  price: number | null;
  mark: number | null;
  markSource: 'yahoo' | 'manual' | null;
  iv: number | null;
  dte: number;
  analysis: OptionAnalysis;
}

export function buildPositionRows(portfolio: Portfolio, quotes: Record<string, Quote>, manual: Record<string, number>): PositionRow[] {
  return portfolio.tickers
    .filter((t) => t.shares > 0)
    .map((t) => {
      const quote = quotes[t.ticker];
      const price = manual[t.ticker] ?? quote?.price ?? null;
      const marketValue = price != null ? price * t.shares : null;
      const trueCost = t.costRaw - t.basisReduction;
      const plTrue = marketValue != null ? marketValue - trueCost : null;
      const plBroker = marketValue != null ? marketValue - t.costRaw : null;
      return {
        ...t,
        price,
        priceSource: manual[t.ticker] != null ? 'manual' : quote ? 'yahoo' : null,
        dayChangePct: quote?.previousClose ? quote.price / quote.previousClose - 1 : null,
        marketValue,
        plTrue,
        plTruePct: plTrue != null && trueCost > 0 ? plTrue / trueCost : null,
        plBroker,
        plBrokerPct: plBroker != null && t.costRaw > 0 ? plBroker / t.costRaw : null,
      } satisfies PositionRow;
    })
    .sort((a, b) => (b.marketValue ?? b.costRaw) - (a.marketValue ?? a.costRaw));
}

export function buildOptionRows(
  portfolio: Portfolio,
  quotes: Record<string, Quote>,
  manualPrices: Record<string, number>,
  optionQuotes: Record<string, OptionQuote>,
  manualMarks: Record<string, number>,
): OptionRow[] {
  const byTicker = new Map(portfolio.tickers.map((t) => [t.ticker, t]));
  return portfolio.openOptions.map((o) => {
    const t = byTicker.get(o.underlying);
    const price = manualPrices[o.underlying] ?? quotes[o.underlying]?.price ?? null;
    const q = optionQuotes[contractKey(o)];
    const mark = manualMarks[o.key] ?? q?.mark ?? null;
    const dte = daysToExpiry(o.expiry);
    const iv = (mark != null && price != null ? impliedVol(o.type, mark, price, o.strike, Math.max(dte, 0.5) / 365) : null) ?? q?.iv ?? null;
    return {
      ...o,
      price,
      mark,
      markSource: manualMarks[o.key] != null ? 'manual' : q?.mark != null ? 'yahoo' : null,
      iv,
      dte,
      analysis: analyzeOption({
        option: o,
        price,
        mark,
        iv,
        sharesHeld: t?.shares ?? 0,
        trueBasis: t?.trueCostBasis ?? null,
        premiumInBasis: !portfolio.basis.realizedOnly,
        dte,
      }),
    };
  });
}
