import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDate, pct, plClass, signedUsd, usd, usdShort } from '../lib/format';
import type { OptionRow } from '../lib/rows';
import { chartTheme } from './chartTheme';
import { Modal } from './Modal';

interface Props {
  row: OptionRow;
  dark: boolean;
  onClose: () => void;
  onSetMark: (key: string, mark: number | null) => void;
  /** Opens the roll planner (short options only). */
  onRoll?: () => void;
}

function Stat({ label, value, sub, className }: { label: string; value: string; sub?: string; className?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${className ?? ''}`}>{value}</div>
      {sub && <div className="text-xs text-zinc-500 dark:text-zinc-400">{sub}</div>}
    </div>
  );
}

export function OptionAnalyzer({ row: o, dark, onClose, onSetMark, onRoll }: Props) {
  const a = o.analysis;
  const c = chartTheme(dark);
  const short = o.side === 'short';
  const kind = short ? (o.type === 'Put' ? 'Cash-secured put' : a.covered ? 'Covered call' : 'Short call') : `Long ${o.type.toLowerCase()}`;
  const showPosition = a.covered;

  const editMark = () => {
    const input = window.prompt(`Option price per share for ${o.underlying} $${o.strike} ${o.type} (blank = use Yahoo):`, o.mark?.toFixed(2) ?? '');
    if (input === null) return;
    const n = parseFloat(input);
    onSetMark(o.key, input.trim() === '' || Number.isNaN(n) ? null : n);
  };

  return (
    <Modal
      title={
        <>
          {o.underlying} ${o.strike} {o.type} · {formatDate(o.expiry)}{' '}
          <span className="text-sm font-normal text-zinc-500 dark:text-zinc-400">
            {o.contracts}× {kind}
          </span>
        </>
      }
      onClose={onClose}
      width="max-w-5xl"
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Contract value now" value={usd(a.contractValue)} sub={o.mark != null ? `${usd(o.mark)}/sh · ${o.markSource}` : 'no quote, click Set price'} />
        <Stat
          label="Unrealized P/L"
          value={signedUsd(a.unrealizedPL)}
          sub={a.unrealizedPct != null ? `${pct(a.unrealizedPct)} of ${usd(a.premium)} premium` : undefined}
          className={plClass(a.unrealizedPL)}
        />
        {short ? (
          <Stat label="Max profit captured" value={a.maxProfitCaptured != null ? `${(a.maxProfitCaptured * 100).toFixed(0)}%` : '—'} sub={`of ${usd(a.premium)} premium`} />
        ) : (
          <Stat label="Premium paid" value={usd(a.premium)} />
        )}
        <Stat label="Max risk used" value={a.riskUsed != null ? `${(a.riskUsed * 100).toFixed(1)}%` : '—'} sub={a.maxRisk != null ? `of ${usd(a.maxRisk)} max risk` : 'unlimited risk'} />
        <Stat label={showPosition ? 'Max profit (position)' : 'Max profit'} value={a.maxProfit != null ? usd(a.maxProfit) : 'Unlimited'} />
        <Stat label={showPosition ? 'Max risk (shares to $0)' : 'Max risk'} value={a.maxRisk != null ? usd(a.maxRisk) : 'Unlimited'} />
        <Stat label="Breakeven at expiry" value={usd(a.breakeven)} sub={o.price != null ? `stock ${usd(o.price)} now` : undefined} />
        <Stat label="Days to expiry" value={o.dte < 0 ? 'Expired' : String(o.dte)} sub={o.iv != null ? `implied vol ${(o.iv * 100).toFixed(0)}%` : undefined} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Stat
          label="Expected P/L at expiry (model)"
          value={signedUsd(a.expectedPL)}
          className={plClass(a.expectedPL)}
          sub={a.expectedPL == null ? 'needs a live price and implied volatility' : 'lognormal model using implied volatility. An estimate, not a forecast.'}
        />
        <Stat label="Probability of profit (model)" value={a.probProfit != null ? `${(a.probProfit * 100).toFixed(0)}%` : '—'} sub={showPosition ? 'chance shares + call are above true basis at expiry' : 'chance the position is profitable at expiry'} />
      </div>

      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-medium">P/L at expiry vs stock price</div>
          <div className="flex gap-2">
            {short && onRoll && o.dte >= 0 && (
              <button className="btn text-xs" onClick={onRoll}>
                Plan a roll…
              </button>
            )}
            <button className="btn text-xs" onClick={editMark}>
              Set price
            </button>
          </div>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={a.curve} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
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
              {o.price != null && <ReferenceLine x={o.price} stroke={c.axis} strokeDasharray="4 4" label={{ value: 'Now', fill: c.axis, fontSize: 11, position: 'top' }} />}
              <ReferenceLine x={a.breakeven} stroke={c.series2} strokeDasharray="2 4" label={{ value: 'Breakeven', fill: c.axis, fontSize: 11, position: 'insideTopRight' }} />
              <Line type="linear" dataKey="option" name={showPosition ? 'Call only' : 'Option P/L'} stroke={c.series1} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              {showPosition && <Line type="linear" dataKey="position" name="Shares + call (vs true basis)" stroke={c.series2} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Modal>
  );
}
