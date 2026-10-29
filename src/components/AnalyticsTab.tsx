import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Portfolio, ShortTrade } from '../engine/types';
import { formatDate, pct, plClass, signedUsd, usd, usdShort } from '../lib/format';
import { chartTheme } from './chartTheme';
import { Tile } from './CyclesTable';

interface Props {
  portfolio: Portfolio;
  monthlyGoal: number;
  dark: boolean;
}

const monthLabel = (m: string) => {
  const [y, mo] = m.split('-');
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleString('en-US', { month: 'short', year: '2-digit' });
};

type SortKey = 'closed' | 'ticker' | 'netPremium' | 'annualizedYield' | 'days';

export function AnalyticsTab({ portfolio: p, monthlyGoal, dark }: Props) {
  const c = chartTheme(dark);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'closed', desc: true });

  const cumulative = useMemo(() => {
    let run = 0;
    return p.premiumByMonth.map((m) => ({ month: m.month, total: (run += m.premium) }));
  }, [p.premiumByMonth]);

  const byTicker = useMemo(() => {
    const rows = p.tickers.filter((t) => Math.abs(t.wheelPremium) > 0.005).map((t) => ({ ticker: t.ticker, premium: t.wheelPremium }));
    rows.sort((a, b) => b.premium - a.premium);
    if (rows.length <= 15) return rows;
    const other = rows.slice(14).reduce((s, r) => s + r.premium, 0);
    return [...rows.slice(0, 14), { ticker: 'Other', premium: other }];
  }, [p.tickers]);

  const trades = p.shortTrades;
  const stats = useMemo(() => {
    if (!trades.length) return null;
    const wins = trades.filter((t) => t.win).length;
    const totalCollateralDays = trades.reduce((s, t) => s + t.collateral * t.days, 0);
    return {
      winRate: wins / trades.length,
      // Capital-weighted: total premium over collateral × time.
      avgYield: totalCollateralDays > 0 ? (trades.reduce((s, t) => s + t.netPremium, 0) / totalCollateralDays) * 365 : null,
      avgDays: trades.reduce((s, t) => s + t.days, 0) / trades.length,
      assignRate: trades.filter((t) => t.outcome === 'assigned').length / trades.length,
    };
  }, [trades]);

  const sorted = useMemo(() => {
    const dir = sort.desc ? -1 : 1;
    return [...trades].sort((a, b) => {
      const av = a[sort.key] as string | number;
      const bv = b[sort.key] as string | number;
      return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
    });
  }, [trades, sort]);

  const tooltip = { contentStyle: { background: c.tooltipBg, border: `1px solid ${c.tooltipBorder}`, borderRadius: 8, color: c.text }, labelStyle: { color: c.text } };
  const axis = { tick: { fill: c.axis, fontSize: 12 }, tickLine: false };

  const Th = ({ k, children, num }: { k: SortKey; children: string; num?: boolean }) => (
    <th className={`th ${num ? 'num' : ''}`}>
      <button onClick={() => setSort({ key: k, desc: sort.key === k ? !sort.desc : true })} className="uppercase hover:text-zinc-800 dark:hover:text-zinc-200">
        {children}
        {sort.key === k ? (sort.desc ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Win rate" value={stats ? `${(stats.winRate * 100).toFixed(0)}%` : '—'} sub={`${trades.length} closed short options`} />
        <Tile label="Annualized yield" value={stats?.avgYield != null ? pct(stats.avgYield) : '—'} sub="premium ÷ collateral × time" />
        <Tile label="Avg days held" value={stats ? stats.avgDays.toFixed(1) : '—'} />
        <Tile label="Assignment rate" value={stats ? `${(stats.assignRate * 100).toFixed(0)}%` : '—'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <div className="mb-3 text-sm font-medium">Monthly premium{monthlyGoal > 0 ? ` vs ${usd(monthlyGoal)} goal` : ''}</div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={p.premiumByMonth} margin={{ top: 4, right: 8, bottom: 0, left: 8 }} barCategoryGap={2}>
                <CartesianGrid vertical={false} stroke={c.grid} />
                <XAxis dataKey="month" tickFormatter={monthLabel} {...axis} axisLine={{ stroke: c.grid }} minTickGap={16} />
                <YAxis tickFormatter={usdShort} {...axis} axisLine={false} width={64} />
                <Tooltip {...tooltip} cursor={{ fill: c.grid, opacity: 0.5 }} labelFormatter={monthLabel} formatter={(v: number) => [usd(v), 'Premium']} />
                {monthlyGoal > 0 && <ReferenceLine y={monthlyGoal} stroke={c.series2} strokeDasharray="4 4" label={{ value: 'Goal', fill: c.axis, fontSize: 11, position: 'insideTopRight' }} />}
                <Bar dataKey="premium" fill={c.series1} radius={[4, 4, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-4">
          <div className="mb-3 text-sm font-medium">Cumulative premium</div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={cumulative} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid vertical={false} stroke={c.grid} />
                <XAxis dataKey="month" tickFormatter={monthLabel} {...axis} axisLine={{ stroke: c.grid }} minTickGap={16} />
                <YAxis tickFormatter={usdShort} {...axis} axisLine={false} width={64} />
                <Tooltip {...tooltip} labelFormatter={monthLabel} formatter={(v: number) => [usd(v), 'Total premium']} />
                <Line type="monotone" dataKey="total" stroke={c.series1} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="mb-3 text-sm font-medium">Net premium by ticker</div>
        <div style={{ height: Math.max(160, byTicker.length * 26) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byTicker} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }} barCategoryGap={2}>
              <CartesianGrid horizontal={false} stroke={c.grid} />
              <XAxis type="number" tickFormatter={usdShort} {...axis} axisLine={{ stroke: c.grid }} />
              <YAxis type="category" dataKey="ticker" {...axis} axisLine={false} width={56} />
              <Tooltip {...tooltip} cursor={{ fill: c.grid, opacity: 0.5 }} formatter={(v: number) => [usd(v), 'Net premium']} />
              <ReferenceLine x={0} stroke={c.axis} strokeOpacity={0.6} />
              <Bar dataKey="premium" fill={c.series1} radius={[0, 4, 4, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <div className="px-4 pt-4 text-sm font-medium">Closed short options</div>
        <table className="mt-2 min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
          <thead>
            <tr>
              <Th k="ticker">Ticker</Th>
              <th className="th">Option</th>
              <Th k="closed">Closed</Th>
              <Th k="days" num>
                Days
              </Th>
              <th className="th">Outcome</th>
              <Th k="netPremium" num>
                Net premium
              </Th>
              <th className="th num">Collateral</th>
              <Th k="annualizedYield" num>
                Annualized
              </Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
            {sorted.map((t: ShortTrade, i) => (
              <tr key={i}>
                <td className="td font-semibold">{t.ticker}</td>
                <td className="td">
                  {t.contracts}× ${t.strike} {t.type} {formatDate(t.expiry)}
                </td>
                <td className="td">{formatDate(t.closed)}</td>
                <td className="td num">{t.days}</td>
                <td className="td capitalize">{t.outcome}</td>
                <td className={`td num ${plClass(t.netPremium)}`}>{signedUsd(t.netPremium)}</td>
                <td className="td num">{usd(t.collateral)}</td>
                <td className={`td num ${plClass(t.annualizedYield)}`}>{pct(t.annualizedYield)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
