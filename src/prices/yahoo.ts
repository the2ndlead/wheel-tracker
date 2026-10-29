import { fetchYahooChart, fetchYahooOptionChain } from '../lib/platform';
import { contractKey } from '../engine/ledger';
import type { OpenOption } from '../engine/types';

export interface Quote {
  price: number;
  previousClose: number | null;
  /** Epoch ms when fetched. */
  fetchedAt: number;
}

const cache = new Map<string, Quote>();
const TTL_MS = 60_000;

/** Robinhood uses BRK.B; Yahoo uses BRK-B. */
export function toYahooSymbol(ticker: string): string {
  return ticker.replace(/\./g, '-');
}

/** Fetches a quote via the desktop main process or the Vite dev-server proxy (see lib/platform.ts). */
export async function fetchQuote(ticker: string, force = false): Promise<Quote> {
  const cached = cache.get(ticker);
  if (!force && cached && Date.now() - cached.fetchedAt < TTL_MS) return cached;

  const json = await fetchYahooChart(toYahooSymbol(ticker));
  const meta = json?.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  if (typeof price !== 'number') throw new Error(`No price for ${ticker}`);
  const quote: Quote = {
    price,
    previousClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
    fetchedAt: Date.now(),
  };
  cache.set(ticker, quote);
  return quote;
}

export async function fetchQuotes(
  tickers: string[],
  force = false,
): Promise<{ quotes: Record<string, Quote>; errors: Record<string, string> }> {
  const quotes: Record<string, Quote> = {};
  const errors: Record<string, string> = {};
  await Promise.all(
    tickers.map(async (t) => {
      try {
        quotes[t] = await fetchQuote(t, force);
      } catch (e) {
        errors[t] = e instanceof Error ? e.message : String(e);
      }
    }),
  );
  return { quotes, errors };
}

export interface OptionQuote {
  bid: number | null;
  ask: number | null;
  last: number | null;
  /** Per-share price used for valuation: bid/ask midpoint, else last trade. */
  mark: number | null;
  /** Implied volatility as a decimal (0.45 = 45%). */
  iv: number | null;
  fetchedAt: number;
}

const optionCache = new Map<string, OptionQuote>();

/** Quotes every open contract, one Yahoo request per underlying + expiry. Keyed by contractKey() (not o.key, which the combined view prefixes with the account). */
export async function fetchOptionQuotes(
  options: OpenOption[],
  force = false,
): Promise<{ quotes: Record<string, OptionQuote>; errors: Record<string, string> }> {
  const quotes: Record<string, OptionQuote> = {};
  const errors: Record<string, string> = {};
  const groups = new Map<string, OpenOption[]>();
  for (const o of options) {
    const cached = optionCache.get(contractKey(o));
    if (!force && cached && Date.now() - cached.fetchedAt < TTL_MS) {
      quotes[contractKey(o)] = cached;
      continue;
    }
    const g = `${o.underlying}|${o.expiry}`;
    groups.set(g, [...(groups.get(g) ?? []), o]);
  }

  await Promise.all(
    [...groups.values()].map(async (group) => {
      const { underlying, expiry } = group[0];
      try {
        const chain = await fetchYahooOptionChain(toYahooSymbol(underlying), expiry);
        const contracts = chain?.options?.[0] ?? {};
        for (const o of group) {
          const list: any[] = (o.type === 'Call' ? contracts.calls : contracts.puts) ?? [];
          const c = list.find((x) => Math.abs(x.strike - o.strike) < 0.001);
          if (!c) {
            errors[o.key] = `${underlying} ${expiry} ${o.type} $${o.strike} not found`;
            continue;
          }
          const bid = num(c.bid);
          const ask = num(c.ask);
          const last = num(c.lastPrice);
          const q: OptionQuote = {
            bid,
            ask,
            last,
            mark: bid != null && ask != null && ask > 0 ? (bid + ask) / 2 : last,
            iv: num(c.impliedVolatility),
            fetchedAt: Date.now(),
          };
          optionCache.set(contractKey(o), q);
          quotes[contractKey(o)] = q;
        }
      } catch (e) {
        for (const o of group) errors[o.key] = e instanceof Error ? e.message : String(e);
      }
    }),
  );
  return { quotes, errors };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export interface ChainContract extends Omit<OptionQuote, 'fetchedAt'> {
  strike: number;
}

export interface OptionChain {
  /** Every listed expiration, ISO dates ascending. */
  expirations: string[];
  calls: ChainContract[];
  puts: ChainContract[];
  underlyingPrice: number | null;
}

const toIso = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);

/** All contracts for one expiration, plus the list of every expiration (for planning a roll). */
export async function fetchChain(underlying: string, expiry: string): Promise<OptionChain> {
  const chain = await fetchYahooOptionChain(toYahooSymbol(underlying), expiry);
  const c = chain?.options?.[0] ?? {};
  const map = (list: any[] | undefined): ChainContract[] =>
    (list ?? []).map((x) => {
      const bid = num(x.bid);
      const ask = num(x.ask);
      const last = num(x.lastPrice);
      return { strike: x.strike, bid, ask, last, mark: bid != null && ask != null && ask > 0 ? (bid + ask) / 2 : last, iv: num(x.impliedVolatility) };
    });
  return {
    expirations: ((chain?.expirationDates ?? []) as number[]).map(toIso),
    calls: map(c.calls),
    puts: map(c.puts),
    underlyingPrice: num(chain?.quote?.regularMarketPrice),
  };
}
