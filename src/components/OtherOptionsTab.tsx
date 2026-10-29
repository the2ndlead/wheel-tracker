import type { ExerciseEvent, LongTrade } from '../engine/types';
import { formatDate, plClass, signedUsd, usd } from '../lib/format';
import type { OptionRow } from '../lib/rows';
import { Tile } from './CyclesTable';

interface Props {
  trades: LongTrade[];
  exercises: ExerciseEvent[];
  /** Live rows for open long options (value now). */
  openRows: OptionRow[];
  onAnalyze: (key: string) => void;
}

const OUTCOME: Record<LongTrade['outcome'], string> = { open: 'Open', closed: 'Sold', expired: 'Expired', exercised: 'Exercised' };

/** Long calls/puts: kept apart from the wheel and never part of wheel premium. */
export function OtherOptionsTab({ trades, exercises, openRows, onAnalyze }: Props) {
  const realized = trades.reduce((s, t) => s + (t.pl ?? 0), 0);
  const openLong = openRows.filter((r) => r.side === 'long');
  const unrealized = openLong.reduce((s, r) => s + (r.analysis.unrealizedPL ?? 0), 0);
  const findOpen = (t: LongTrade) => openLong.find((r) => r.underlying === t.ticker && r.expiry === t.expiry && r.strike === t.strike && r.type === t.type);

  if (!trades.length) return <div className="card p-6 text-center text-sm text-zinc-500">No long option trades.</div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Realized P/L" value={signedUsd(realized)} className={plClass(realized)} sub="sold or expired" />
        <Tile label="Unrealized P/L" value={signedUsd(unrealized)} className={plClass(unrealized)} sub={`${openLong.length} open position(s)`} />
        <Tile label="Win rate" value={winRate(trades)} sub="of closed trades" />
        <Tile label="Exercised" value={String(exercises.length)} sub="premium added to share cost" />
      </div>

      {exercises.length > 0 && (
        <div className="card p-4 text-sm">
          <div className="mb-2 font-medium">Exercises</div>
          <ul className="space-y-1">
            {exercises.map((e, i) => (
              <li key={i}>
                {formatDate(e.date)}: exercised {e.contracts}× {e.ticker} ${e.strike} {e.type.toLowerCase()}.{' '}
                <span className="text-zinc-500 dark:text-zinc-400">
                  {usd(e.premiumPaid)} premium {e.type === 'Call' ? `added to the cost of the ${e.contracts * 100} shares bought` : 'subtracted from the sale proceeds'}. It is
                  not counted as wheel premium.
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
          <thead>
            <tr>
              <th className="th">Ticker</th>
              <th className="th">Option</th>
              <th className="th">Opened</th>
              <th className="th">Closed</th>
              <th className="th">Outcome</th>
              <th className="th num">Cost</th>
              <th className="th num">Proceeds / value</th>
              <th className="th num">P/L</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
            {trades.map((t, i) => {
              const live = t.outcome === 'open' ? findOpen(t) : undefined;
              const pl = t.outcome === 'open' ? live?.analysis.unrealizedPL ?? null : t.pl;
              return (
                <tr key={i} className={live ? 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50' : ''} onClick={live ? () => onAnalyze(live.key) : undefined}>
                  <td className="td font-semibold">{t.ticker}</td>
                  <td className="td">
                    {t.contracts}× ${t.strike} {t.type} {formatDate(t.expiry)}
                  </td>
                  <td className="td">{formatDate(t.opened)}</td>
                  <td className="td">{t.closed ? formatDate(t.closed) : '—'}</td>
                  <td className="td">{OUTCOME[t.outcome]}</td>
                  <td className="td num">{usd(t.cost)}</td>
                  <td className="td num">{t.outcome === 'open' ? usd(live?.analysis.contractValue) : t.outcome === 'exercised' ? '→ shares' : usd(t.proceeds)}</td>
                  <td className={`td num ${plClass(pl)}`}>
                    {t.outcome === 'exercised' ? <span className="text-xs text-zinc-500">in share cost</span> : signedUsd(pl)}
                    {t.outcome === 'open' && <div className="text-xs text-zinc-500">unrealized</div>}
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

function winRate(trades: LongTrade[]) {
  const closed = trades.filter((t) => t.pl != null);
  return closed.length ? `${((closed.filter((t) => (t.pl ?? 0) > 0).length / closed.length) * 100).toFixed(0)}%` : '—';
}
