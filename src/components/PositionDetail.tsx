import { useEffect } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDate, pct, plClass, qty, signedUsd, usd } from '../lib/format';
import type { TickerPosition } from '../engine/types';
import type { PositionRow } from '../lib/rows';
import { chartTheme } from './chartTheme';
import { OptionBadges } from './PositionsTable';

interface Props {
  position: TickerPosition;
  row?: PositionRow;
  dark: boolean;
  /** Combined view: show which account each trade came from. */
  showAccount?: boolean;
  onBreakdown: () => void;
  onClose: () => void;
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${className ?? ''}`}>{value}</div>
    </div>
  );
}

export function PositionDetail({ position: p, row, dark, showAccount, onBreakdown, onClose }: Props) {
  const c = chartTheme(dark);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const totalReturn = p.wheelPremium + p.realizedStock + p.otherOptionsPL + p.dividends + (row?.plBroker ?? 0);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="card my-8 w-full max-w-5xl p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold">{p.ticker}</h2>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">
              {p.shares > 0 ? `${qty(p.shares)} shares` : 'No shares held'} · {p.transactions.length} transactions
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn" onClick={onBreakdown}>
              What lowered my basis?
            </button>
            <button className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="True cost basis" value={usd(p.trueCostBasis)} />
          <Stat label="Avg cost (broker)" value={p.shares > 0 ? usd(p.avgCost) : '—'} />
          <Stat label="Current price" value={usd(row?.price)} />
          <Stat label="P/L vs true basis" value={`${signedUsd(row?.plTrue)} (${pct(row?.plTruePct)})`} className={plClass(row?.plTrue)} />
          <Stat label="Put premium" value={usd(p.putPremium)} className={plClass(p.putPremium)} />
          <Stat label="Call premium" value={usd(p.callPremium)} className={plClass(p.callPremium)} />
          <Stat label="Realized stock P/L" value={signedUsd(p.realizedStock)} className={plClass(p.realizedStock)} />
          <Stat label="Dividends" value={usd(p.dividends)} />
          <Stat label="Other options P/L" value={signedUsd(p.otherOptionsPL)} className={plClass(p.otherOptionsPL)} />
          <Stat label="Total return (all-in)" value={signedUsd(totalReturn)} className={plClass(totalReturn)} />
        </div>

        {(p.cycles.length > 0 || p.exercises.length > 0) && (
          <div className="mt-4 space-y-1 text-sm text-zinc-600 dark:text-zinc-300">
            {p.cycles.map((c) => (
              <div key={c.index}>
                Wheel cycle #{c.index}: {formatDate(c.start)} – {c.end ? formatDate(c.end) : 'now'} · premium {usd(c.premium)} · stock{' '}
                {signedUsd(c.stockPL)} ·{' '}
                <span className={plClass(c.totalReturn)}>
                  {signedUsd(c.totalReturn)} realized{c.annualizedPct != null && c.status === 'closed' ? ` (${pct(c.annualizedPct)} annualized)` : ''}
                </span>
              </div>
            ))}
            {p.exercises.map((e, i) => (
              <div key={i} className="text-zinc-500 dark:text-zinc-400">
                {formatDate(e.date)}: exercised {e.contracts}× ${e.strike} {e.type.toLowerCase()}. {usd(e.premiumPaid)} premium{' '}
                {e.type === 'Call' ? 'added to share cost' : 'subtracted from proceeds'} (not wheel premium).
              </div>
            ))}
          </div>
        )}

        {p.openOptions.length > 0 && (
          <div className="mt-4">
            <OptionBadges options={p.openOptions} />
          </div>
        )}

        {p.history.filter((h) => h.shares > 0).length > 1 && (
          <div className="mt-6">
            <div className="mb-2 text-sm font-medium">Cost basis over time</div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={p.history.filter((h) => h.shares > 0)} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid vertical={false} stroke={c.grid} />
                  <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fill: c.axis, fontSize: 12 }} axisLine={{ stroke: c.grid }} tickLine={false} minTickGap={24} />
                  <YAxis tickFormatter={(v: number) => `$${v.toFixed(0)}`} tick={{ fill: c.axis, fontSize: 12 }} axisLine={false} tickLine={false} width={56} domain={['auto', 'auto']} />
                  <Tooltip
                    contentStyle={{ background: c.tooltipBg, border: `1px solid ${c.tooltipBorder}`, borderRadius: 8, color: c.text }}
                    labelStyle={{ color: c.text }}
                    labelFormatter={formatDate}
                    formatter={(v: number, name: string) => [usd(v), name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: c.axis }} />
                  <Line type="stepAfter" dataKey="avgCost" name="Avg cost" stroke={c.series2} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                  <Line type="stepAfter" dataKey="trueBasis" name="True cost basis" stroke={c.series1} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className="mt-6">
          <div className="mb-2 text-sm font-medium">Transactions</div>
          <div className="max-h-96 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
              <thead className="sticky top-0 bg-white dark:bg-zinc-900">
                <tr>
                  <th className="th">Date</th>
                  {showAccount && <th className="th">Account</th>}
                  <th className="th">Code</th>
                  <th className="th">Description</th>
                  <th className="th num">Qty</th>
                  <th className="th num">Price</th>
                  <th className="th num">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
                {[...p.transactions].reverse().map((t) => (
                  <tr key={t.id} className={t.synthetic ? 'italic text-amber-700 dark:text-amber-300' : ''}>
                    <td className="td">{formatDate(t.date)}</td>
                    {showAccount && <td className="td text-xs">{t.source}</td>}
                    <td className="td font-mono text-xs">{t.code}</td>
                    <td className="td max-w-xs truncate" title={t.description}>
                      {t.manual && <span className="mr-1.5 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">Manual</span>}
                      {t.description.split('\n')[0]}
                    </td>
                    <td className="td num">{qty(t.quantity)}</td>
                    <td className="td num">{t.price ? usd(t.price) : ''}</td>
                    <td className={`td num ${plClass(t.amount)}`}>{t.amount ? signedUsd(t.amount) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
