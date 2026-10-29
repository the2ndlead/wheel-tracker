import { formatDate, plClass, signedUsd, usd } from '../lib/format';
import type { OptionRow } from '../lib/rows';

interface Props {
  rows: OptionRow[];
  onAnalyze: (key: string) => void;
  onRoll: (key: string) => void;
  /** Opens the strategy view for a ticker (several positions together). */
  onCombine: (ticker: string) => void;
}

export function OpenOptionsTable({ rows, onAnalyze, onRoll, onCombine }: Props) {
  if (!rows.length) return <div className="card p-6 text-center text-sm text-zinc-500">No open option contracts.</div>;
  const live = rows.filter((o) => o.dte >= 0);
  const legs = new Map<string, number>();
  live.forEach((o) => legs.set(o.underlying, (legs.get(o.underlying) ?? 0) + 1));
  // Default to a ticker mixing short and long options (e.g. puts paying for a call), then the most contracts.
  const score = (t: string) => {
    const mine = live.filter((o) => o.underlying === t);
    const mixed = mine.some((o) => o.side === 'short') && mine.some((o) => o.side === 'long');
    return (mixed ? 1e6 : 0) + mine.reduce((s, o) => s + o.contracts, 0);
  };
  const first = [...legs.keys()].sort((a, b) => score(b) - score(a))[0] ?? rows[0].underlying;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-zinc-500 dark:text-zinc-400">
        <span>Click a row to analyze one contract, or combine several positions on a ticker (e.g. short puts + a long call) to see their total risk and return.</span>
        <button className="btn text-xs" onClick={() => onCombine(first)}>
          Combine positions…
        </button>
      </div>
      <div className="card overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
          <thead>
            <tr>
              <th className="th">Ticker</th>
              <th className="th">Position</th>
              <th className="th num">Strike</th>
              <th className="th">Expiry</th>
              <th className="th num">DTE</th>
              <th className="th num">Stock</th>
              <th className="th num">Premium</th>
              <th className="th num">Value now</th>
              <th className="th num">P/L</th>
              <th className="th num">Max profit captured</th>
              <th className="th num">Collateral</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
            {rows.map((o) => {
              const a = o.analysis;
              const label = o.side === 'short' ? (o.type === 'Call' ? 'Covered call' : 'Cash-secured put') : `Long ${o.type.toLowerCase()}`;
              const itm = o.price != null && (o.type === 'Put' ? o.price < o.strike : o.price > o.strike);
              return (
                <tr key={o.key + o.side} className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50" onClick={() => onAnalyze(o.key)}>
                  <td className="td font-semibold">{o.underlying}</td>
                  <td className="td">
                    {o.contracts}× {label}
                    {itm && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">ITM</span>}
                  </td>
                  <td className="td num">{usd(o.strike)}</td>
                  <td className="td">{formatDate(o.expiry)}</td>
                  <td className={`td num ${o.dte <= 7 ? 'font-semibold text-amber-600 dark:text-amber-400' : ''}`}>{o.dte < 0 ? 'expired' : o.dte}</td>
                  <td className="td num">{usd(o.price)}</td>
                  <td className="td num">{usd(a.premium)}</td>
                  <td className="td num">
                    {usd(a.contractValue)}
                    {o.markSource === 'manual' && <div className="text-xs text-amber-600 dark:text-amber-400">manual</div>}
                  </td>
                  <td className={`td num ${plClass(a.unrealizedPL)}`}>{signedUsd(a.unrealizedPL)}</td>
                  <td className="td num">
                    {a.maxProfitCaptured != null ? (
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700" aria-hidden>
                          <div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.max(0, Math.min(1, a.maxProfitCaptured)) * 100}%` }} />
                        </div>
                        {(a.maxProfitCaptured * 100).toFixed(0)}%
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="td num">{o.side === 'short' && o.type === 'Put' ? usd(o.strike * 100 * o.contracts) : '—'}</td>
                  <td className="td whitespace-nowrap text-right">
                    {o.side === 'short' && o.dte >= 0 && (
                      <button
                        className="btn mr-2 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRoll(o.key);
                        }}
                      >
                        Roll…
                      </button>
                    )}
                    {(legs.get(o.underlying) ?? 0) > 1 && o.dte >= 0 && (
                      <button
                        className="btn mr-2 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCombine(o.underlying);
                        }}
                      >
                        Combine…
                      </button>
                    )}
                    <span className="text-sm text-sky-600 dark:text-sky-400">Analyze →</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
