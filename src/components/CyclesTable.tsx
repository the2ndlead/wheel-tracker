import { Fragment, useState } from 'react';
import type { TickerPosition, WheelCycle } from '../engine/types';
import { formatDate, pct, plClass, signedUsd, usd } from '../lib/format';

interface Props {
  cycles: WheelCycle[];
  tickers: TickerPosition[];
  /** Unrealized stock P/L (vs avg cost) by ticker, for open cycles. */
  unrealized: Record<string, number | null>;
}

export function CyclesTable({ cycles, tickers, unrealized }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!cycles.length) return <div className="card p-6 text-center text-sm text-zinc-500">No wheel cycles yet.</div>;

  const closed = cycles.filter((c) => c.status === 'closed');
  const totals = closed.reduce((s, c) => ({ ret: s.ret + c.totalReturn, prem: s.prem + c.premium, stock: s.stock + c.stockPL }), { ret: 0, prem: 0, stock: 0 });
  const winRate = closed.length ? closed.filter((c) => c.totalReturn > 0).length / closed.length : null;
  const byTicker = new Map(tickers.map((t) => [t.ticker, t]));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Closed cycles" value={String(closed.length)} />
        <Tile label="Realized from closed cycles" value={signedUsd(totals.ret)} className={plClass(totals.ret)} />
        <Tile label="Profitable cycles" value={winRate != null ? `${(winRate * 100).toFixed(0)}%` : '—'} />
        <Tile label="Open cycles" value={String(cycles.length - closed.length)} />
      </div>
      <div className="card overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
          <thead>
            <tr>
              <th className="th">Ticker</th>
              <th className="th">Status</th>
              <th className="th">Dates</th>
              <th className="th num">Days</th>
              <th className="th num">Premium</th>
              <th className="th num">Stock P/L</th>
              <th className="th num">Dividends</th>
              <th className="th num">Total return</th>
              <th className="th num">Capital</th>
              <th className="th num">Return</th>
              <th className="th num">Annualized</th>
              <th className="th">Events</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
            {cycles.map((c) => {
              const id = `${c.ticker}-${c.index}`;
              const open = c.status === 'open';
              const unreal = open ? unrealized[c.ticker] ?? null : null;
              const total = c.totalReturn + (unreal ?? 0);
              const ret = c.capital > 0 ? total / c.capital : null;
              // Annualizing a few days of premium gives meaningless numbers.
              const annual = ret != null && c.days >= 14 ? ret * (365 / c.days) : null;
              const txs = (byTicker.get(c.ticker)?.transactions ?? []).filter((t) => t.date >= c.start && (!c.end || t.date <= c.end));
              return (
                <Fragment key={id}>
                  <tr className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50" onClick={() => setExpanded(expanded === id ? null : id)}>
                    <td className="td font-semibold">
                      {c.ticker} <span className="text-xs font-normal text-zinc-500">#{c.index}</span>
                    </td>
                    <td className="td">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                          open ? 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300' : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-700/50 dark:text-zinc-300'
                        }`}
                      >
                        {open ? 'Open' : 'Closed'}
                      </span>
                    </td>
                    <td className="td text-zinc-500 dark:text-zinc-400">
                      {formatDate(c.start)} – {c.end ? formatDate(c.end) : 'now'}
                    </td>
                    <td className="td num">{c.days}</td>
                    <td className={`td num ${plClass(c.premium)}`}>{usd(c.premium)}</td>
                    <td className={`td num ${plClass(c.stockPL)}`}>
                      {signedUsd(c.stockPL)}
                      {unreal != null && <div className="text-xs text-zinc-500">{signedUsd(unreal)} unrealized</div>}
                    </td>
                    <td className="td num">{usd(c.dividends)}</td>
                    <td className={`td num font-semibold ${plClass(total)}`}>{signedUsd(total)}</td>
                    <td className="td num">{usd(c.capital)}</td>
                    <td className={`td num ${plClass(ret)}`}>{pct(ret)}</td>
                    <td className={`td num ${plClass(annual)}`}>{pct(annual)}</td>
                    <td className="td text-xs text-zinc-500 dark:text-zinc-400">
                      {[c.assignments && `${c.assignments} assigned`, c.calledAway && `${c.calledAway} called away`].filter(Boolean).join(' · ') || '—'}
                    </td>
                  </tr>
                  {expanded === id && (
                    <tr>
                      <td colSpan={12} className="bg-zinc-50 px-6 py-3 dark:bg-zinc-950/50">
                        <ul className="space-y-0.5 text-xs">
                          {txs.map((t) => (
                            <li key={t.id} className="flex gap-3 tabular-nums">
                              <span className="w-16 text-zinc-500">{formatDate(t.date)}</span>
                              <span className="w-12 font-mono">{t.code}</span>
                              <span className="flex-1 truncate">{t.description.split('\n')[0]}</span>
                              <span className={plClass(t.amount)}>{t.amount ? signedUsd(t.amount) : ''}</span>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        A cycle starts with a cash-secured put or a share purchase and ends when you hold no shares and no short options. Capital = the peak
        of share cost plus put collateral. Open cycles include unrealized stock P/L at today's price.
      </p>
    </div>
  );
}

export function Tile({ label, value, className, sub }: { label: string; value: string; className?: string; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${className ?? ''}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{sub}</div>}
    </div>
  );
}
