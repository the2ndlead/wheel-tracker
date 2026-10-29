import { useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { contractKey } from '../engine/ledger';
import { analyzeStrategy, type StrategyLeg } from '../engine/strategy';
import type { TickerPosition } from '../engine/types';
import { formatDate, plClass, qty, signedUsd, usd, usdShort } from '../lib/format';
import type { OptionRow, PositionRow } from '../lib/rows';
import { chartTheme } from './chartTheme';
import { Modal, inputClass } from './Modal';

interface Props {
  ticker: string;
  optionRows: OptionRow[];
  tickers: TickerPosition[];
  positionRows: PositionRow[];
  /** Open short premium is already inside trueCostBasis (include-open mode). */
  premiumInBasis: boolean;
  dark: boolean;
  onClose: () => void;
}

const SHARES_ID = 'shares';

function Stat({ label, value, sub, className }: { label: string; value: string; sub?: string; className?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${className ?? ''}`}>{value}</div>
      {sub && <div className="text-xs text-zinc-500 dark:text-zinc-400">{sub}</div>}
    </div>
  );
}

/** Account name in the combined view (option keys there are `<account>:<contract>`). */
const accountOf = (o: OptionRow) => {
  const k = contractKey(o);
  return o.key !== k && o.key.endsWith(`:${k}`) ? o.key.slice(0, -k.length - 1) : null;
};

const describe = (o: OptionRow) => `${o.contracts}× ${o.side === 'short' ? 'Short' : 'Long'} ${o.type.toLowerCase()} $${o.strike} · ${formatDate(o.expiry)}`;

/** Several positions on one ticker analyzed together: total risk, return and payoff. */
export function StrategyAnalyzer({ ticker: initial, optionRows, tickers, positionRows, premiumInBasis, dark, onClose }: Props) {
  const c = chartTheme(dark);
  const live = optionRows.filter((o) => o.dte >= 0);
  const choices = [...new Set([...live.map((o) => o.underlying), ...tickers.filter((t) => t.shares > 0).map((t) => t.ticker)])].sort();
  const [ticker, setTicker] = useState(initial);
  const options = live.filter((o) => o.underlying === ticker).sort((a, b) => a.expiry.localeCompare(b.expiry) || a.strike - b.strike);
  const position = tickers.find((t) => t.ticker === ticker && t.shares > 0);
  const price = positionRows.find((r) => r.ticker === ticker)?.price ?? options.find((o) => o.price != null)?.price ?? null;

  // Shares are measured from the true basis without open premium; the option legs add their own premium.
  const sharesBasis = position?.trueCostBasis != null
    ? position.trueCostBasis + (premiumInBasis ? options.filter((o) => o.side === 'short').reduce((s, o) => s + o.cash, 0) / position.shares : 0)
    : null;

  const allIds = () => new Set([...options.map((o) => o.key + o.side), ...(position ? [SHARES_ID] : [])]);
  const [picked, setPicked] = useState<Set<string>>(allIds);
  const pick = (t: string) => {
    setTicker(t);
    const opts = live.filter((o) => o.underlying === t);
    setPicked(new Set([...opts.map((o) => o.key + o.side), ...(tickers.some((p) => p.ticker === t && p.shares > 0) ? [SHARES_ID] : [])]));
  };
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const legs: StrategyLeg[] = useMemo(() => {
    const out: StrategyLeg[] = options
      .filter((o) => picked.has(o.key + o.side))
      .map((o) => ({ kind: 'option', id: o.key + o.side, type: o.type, side: o.side, strike: o.strike, contracts: o.contracts, expiry: o.expiry, cash: o.cash, mark: o.mark, iv: o.iv, dte: o.dte }));
    if (position && sharesBasis != null && picked.has(SHARES_ID)) out.push({ kind: 'shares', id: SHARES_ID, shares: position.shares, basis: sharesBasis });
    return out;
  }, [options, picked, position, sharesBasis]);
  const a = useMemo(() => (legs.length ? analyzeStrategy(legs, price) : null), [legs, price]);

  const horizonLabel = a?.horizonDate ? formatDate(a.horizonDate) : 'expiry';
  const credit = (a?.netPremium ?? 0) >= 0;

  return (
    <Modal
      title={
        <span className="flex flex-wrap items-center gap-2">
          Combine positions
          <select className={inputClass.replace('w-full', 'w-auto')} value={ticker} onChange={(e) => pick(e.target.value)} aria-label="Ticker">
            {choices.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          {price != null && <span className="text-sm font-normal text-zinc-500 dark:text-zinc-400">stock {usd(price)}</span>}
        </span>
      }
      onClose={onClose}
      width="max-w-5xl"
    >
      <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
        Tick the positions that make up your strategy, e.g. two short puts that pay for a long call. Everything below is for the ticked positions together.
      </p>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          <thead>
            <tr>
              <th className="th w-8" />
              <th className="th">Position</th>
              <th className="th num">DTE</th>
              <th className="th num">Opened for</th>
              <th className="th num">Value now</th>
              <th className="th num">P/L now</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
            {options.map((o) => {
              const id = o.key + o.side;
              const acct = accountOf(o);
              return (
                <tr key={id} className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50" onClick={() => toggle(id)}>
                  <td className="td">
                    <input type="checkbox" checked={picked.has(id)} onChange={() => toggle(id)} onClick={(e) => e.stopPropagation()} aria-label={describe(o)} />
                  </td>
                  <td className="td">
                    {describe(o)}
                    {acct && <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">{acct}</span>}
                  </td>
                  <td className="td num">{o.dte}</td>
                  <td className={`td num ${plClass(o.cash)}`}>
                    {signedUsd(o.cash)}
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">{o.side === 'short' ? 'received' : 'paid'}</div>
                  </td>
                  <td className="td num">{o.mark != null ? usd(o.mark * 100 * o.contracts) : '—'}</td>
                  <td className={`td num ${plClass(o.analysis.unrealizedPL)}`}>{signedUsd(o.analysis.unrealizedPL)}</td>
                </tr>
              );
            })}
            {position && (
              <tr className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50" onClick={() => toggle(SHARES_ID)}>
                <td className="td">
                  <input type="checkbox" checked={picked.has(SHARES_ID)} onChange={() => toggle(SHARES_ID)} onClick={(e) => e.stopPropagation()} aria-label="Shares" />
                </td>
                <td className="td">
                  {qty(position.shares)} shares
                  <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">measured from true basis {usd(sharesBasis)}</span>
                </td>
                <td className="td num">—</td>
                <td className="td num">{usd(sharesBasis != null ? sharesBasis * position.shares : null)}</td>
                <td className="td num">{price != null ? usd(price * position.shares) : '—'}</td>
                <td className={`td num ${plClass(price != null && sharesBasis != null ? (price - sharesBasis) * position.shares : null)}`}>
                  {signedUsd(price != null && sharesBasis != null ? (price - sharesBasis) * position.shares : null)}
                </td>
              </tr>
            )}
            {!options.length && !position && (
              <tr>
                <td className="td text-center text-zinc-500" colSpan={6}>
                  No open positions on {ticker}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!a ? (
        <div className="mt-4 text-center text-sm text-zinc-500 dark:text-zinc-400">Tick at least one position.</div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat
              label={credit ? 'Net credit at open' : 'Net debit at open'}
              value={usd(Math.abs(a.netPremium))}
              className={plClass(a.netPremium)}
              sub={credit ? 'premium received − premium paid' : 'premium paid − premium received'}
            />
            <Stat label="P/L now" value={signedUsd(a.unrealizedPL)} className={plClass(a.unrealizedPL)} sub={a.unrealizedPL == null ? 'needs a price for every position' : 'options at mark, shares at price'} />
            <Stat label={`Max profit by ${horizonLabel}`} value={a.maxProfit == null ? 'Unlimited' : signedUsd(a.maxProfit)} sub={a.maxProfit == null ? 'keeps growing as the stock rises' : undefined} />
            <Stat
              label={`Max loss by ${horizonLabel}`}
              value={a.maxLoss == null ? 'Unlimited' : usd(a.maxLoss)}
              className={a.maxLoss ? 'text-rose-600 dark:text-rose-400' : undefined}
              sub={a.maxLoss == null ? 'uncovered short call' : a.maxLossAt != null ? `if the stock is at ${usd(a.maxLossAt)}` : undefined}
            />
            <Stat
              label={a.breakevens.length > 1 ? 'Breakevens' : 'Breakeven'}
              value={a.breakevens.length ? a.breakevens.map((b) => usd(b)).join(' · ') : 'None'}
              sub={a.breakevens.length && price != null ? `stock ${usd(price)} now` : a.breakevens.length ? undefined : 'P/L never crosses $0'}
            />
            <Stat label="Cash to secure puts" value={usd(a.collateral)} sub={a.collateral ? 'strike × 100 × contracts' : 'no short puts'} />
            <Stat
              label="Acts like"
              value={a.delta == null ? '—' : `${a.delta >= 0 ? '' : '−'}${Math.abs(a.delta).toFixed(0)} shares`}
              sub={a.delta == null ? 'needs implied volatility' : 'net delta: P/L for a $1 move today'}
            />
            <Stat
              label="Chance of profit (model)"
              value={a.probProfit != null ? `${(a.probProfit * 100).toFixed(0)}%` : '—'}
              sub={a.expectedPL != null ? `expected ${signedUsd(a.expectedPL)} at ${horizonLabel}` : 'needs a price and implied volatility'}
            />
          </div>

          {(a.nakedCalls > 0 || a.laterLegs) && (
            <div className="mt-3 space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
              {a.nakedCalls > 0 && <div className="text-amber-700 dark:text-amber-400">⚠ {a.nakedCalls} short call(s) aren't covered by shares or a long call in this selection: the loss is unlimited.</div>}
              {a.laterLegs && (
                <div>
                  P/L "by {horizonLabel}" is when the first option expires. Options expiring later are valued then with Black–Scholes at today's implied volatility (an estimate).
                </div>
              )}
            </div>
          )}

          {a.scenarios.length > 0 && (
            <div className="mt-5">
              <div className="mb-2 text-sm font-medium">P/L by {horizonLabel} if the stock moves</div>
              <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                <table className="min-w-full text-sm">
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
                    <tr>
                      <th className="th">Stock</th>
                      {a.scenarios.map((s) => (
                        <td key={s.move} className={`td num ${s.move === 0 ? 'font-semibold' : ''}`}>
                          {s.move === 0 ? 'Now' : `${s.move > 0 ? '+' : ''}${(s.move * 100).toFixed(0)}%`}
                          <div className="text-xs text-zinc-500 dark:text-zinc-400">{usd(s.price)}</div>
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <th className="th">P/L</th>
                      {a.scenarios.map((s) => (
                        <td key={s.move} className={`td num ${plClass(s.pl)} ${s.move === 0 ? 'font-semibold' : ''}`}>
                          {signedUsd(s.pl)}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="mt-5">
            <div className="mb-2 text-sm font-medium">P/L vs stock price</div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={a.curve} margin={{ top: 20, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid vertical={false} stroke={c.grid} />
                  <XAxis
                    dataKey="price"
                    type="number"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                    tick={{ fill: c.axis, fontSize: 12 }}
                    axisLine={{ stroke: c.grid }}
                    tickLine={false}
                  />
                  <YAxis tickFormatter={usdShort} tick={{ fill: c.axis, fontSize: 12 }} axisLine={false} tickLine={false} width={72} />
                  <Tooltip
                    contentStyle={{ background: c.tooltipBg, border: `1px solid ${c.tooltipBorder}`, borderRadius: 8, color: c.text }}
                    labelStyle={{ color: c.text }}
                    labelFormatter={(v: number) => `Stock at ${usd(v)}`}
                    formatter={(v: number, name: string) => [signedUsd(v), name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: c.axis }} />
                  <ReferenceLine y={0} stroke={c.axis} strokeOpacity={0.6} />
                  {price != null && <ReferenceLine x={price} stroke={c.axis} strokeDasharray="4 4" label={{ value: 'Now', fill: c.axis, fontSize: 11, position: 'top' }} />}
                  {a.breakevens.map((b) => (
                    <ReferenceLine key={b} x={b} stroke={c.series2} strokeDasharray="2 4" />
                  ))}
                  <Line type="linear" dataKey="horizon" name={`At ${horizonLabel}`} stroke={c.series1} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                  {a.curve[0]?.today != null && (
                    <Line type="monotone" dataKey="today" name="Today (model)" stroke={c.series2} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              Dotted lines mark breakevens. "Today (model)" is what the positions would be worth right now at each stock price. Model numbers use implied volatility and are estimates, not forecasts.
            </p>
          </div>
        </>
      )}
    </Modal>
  );
}
