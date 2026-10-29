import { plClass, signedUsd, usd } from '../lib/format';
import type { TickerPosition } from '../engine/types';
import { OptionBadges } from './PositionsTable';

/** Tickers with no shares held: fully wheeled out, puts that never assigned, or open CSPs only. */
export function ClosedTable({ rows, onSelect }: { rows: TickerPosition[]; onSelect: (t: string) => void }) {
  if (!rows.length) return <div className="card p-6 text-center text-sm text-zinc-500">Nothing here yet.</div>;
  return (
    <div className="card overflow-x-auto">
      <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
        <thead>
          <tr>
            <th className="th">Ticker</th>
            <th className="th num">Wheel premium</th>
            <th className="th num">Realized stock P/L</th>
            <th className="th num">Other options P/L</th>
            <th className="th num">Dividends</th>
            <th className="th num">Total realized</th>
            <th className="th">Open options</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
          {rows.map((r) => {
            const total = r.wheelPremium + r.realizedStock + r.otherOptionsPL + r.dividends;
            return (
              <tr key={r.ticker} className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50" onClick={() => onSelect(r.ticker)}>
                <td className="td font-semibold">{r.ticker}</td>
                <td className={`td num ${plClass(r.wheelPremium)}`}>{usd(r.wheelPremium)}</td>
                <td className={`td num ${plClass(r.realizedStock)}`}>{signedUsd(r.realizedStock)}</td>
                <td className={`td num ${plClass(r.otherOptionsPL)}`}>{signedUsd(r.otherOptionsPL)}</td>
                <td className="td num">{usd(r.dividends)}</td>
                <td className={`td num font-semibold ${plClass(total)}`}>{signedUsd(total)}</td>
                <td className="td">
                  <OptionBadges options={r.openOptions} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
