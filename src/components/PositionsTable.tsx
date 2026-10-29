import { pct, plClass, qty, signedUsd, usd } from '../lib/format';
import type { OpenOption } from '../engine/types';
import type { PositionRow } from '../lib/rows';

interface Props {
  rows: PositionRow[];
  /** e.g. "all premium" / "current cycle + dividends", shown under the column header. */
  basisLabel: string;
  onSelect: (ticker: string) => void;
  onOverridePrice: (ticker: string, price: number | null) => void;
  /** Opens the "which trades lowered my basis" window. */
  onBasisClick: (ticker: string) => void;
}

export function PositionsTable({ rows, basisLabel, onSelect, onOverridePrice, onBasisClick }: Props) {
  if (!rows.length) {
    return <div className="card p-6 text-center text-sm text-zinc-500">No open stock positions.</div>;
  }
  return (
    <div className="card overflow-x-auto">
      <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
        <thead>
          <tr>
            <th className="th">Ticker</th>
            <th className="th num">Shares</th>
            <th className="th num">Price</th>
            <th className="th num">Market value</th>
            <th className="th num">Avg cost</th>
            <th className="th num">
              True cost basis
              <div className="font-normal normal-case tracking-normal">{basisLabel}</div>
            </th>
            <th className="th num">P/L vs true basis</th>
            <th className="th num">P/L vs avg cost</th>
            <th className="th num">Premium collected</th>
            <th className="th">Open options</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
          {rows.map((r) => {
            const reduction = r.avgCost - (r.trueCostBasis ?? r.avgCost);
            return (
              <tr key={r.ticker} className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50" onClick={() => onSelect(r.ticker)}>
                <td className="td font-semibold">{r.ticker}</td>
                <td className="td num">{qty(r.shares)}</td>
                <td className="td num" onClick={(e) => e.stopPropagation()}>
                  <PriceCell row={r} onOverride={onOverridePrice} />
                </td>
                <td className="td num">{usd(r.marketValue)}</td>
                <td className="td num text-zinc-500 dark:text-zinc-400">{usd(r.avgCost)}</td>
                <td className="td num" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => onBasisClick(r.ticker)} className="group text-right" title="See which trades lowered the basis">
                    <div className="font-semibold underline decoration-dotted underline-offset-4 group-hover:text-sky-600 dark:group-hover:text-sky-400">
                      {usd(r.trueCostBasis)}
                    </div>
                    {Math.abs(reduction) > 0.005 && (
                      <div className={`text-xs ${reduction > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        {reduction > 0 ? '−' : '+'}
                        {usd(Math.abs(reduction))}/sh
                      </div>
                    )}
                  </button>
                </td>
                <td className={`td num ${plClass(r.plTrue)}`}>
                  <div className="font-semibold">{signedUsd(r.plTrue)}</div>
                  <div className="text-xs">{pct(r.plTruePct)}</div>
                </td>
                <td className={`td num ${plClass(r.plBroker)}`}>
                  <div>{signedUsd(r.plBroker)}</div>
                  <div className="text-xs">{pct(r.plBrokerPct)}</div>
                </td>
                <td className={`td num ${plClass(r.wheelPremium)}`}>{usd(r.wheelPremium)}</td>
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

export function OptionBadges({ options }: { options: OpenOption[] }) {
  if (!options.length) return <span className="text-zinc-400 dark:text-zinc-600">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => {
        const label = o.side === 'short' ? (o.type === 'Call' ? 'CC' : 'CSP') : o.type === 'Call' ? 'Long C' : 'Long P';
        const color =
          o.side === 'short'
            ? o.type === 'Call'
              ? 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300'
              : 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300'
            : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-700/50 dark:text-zinc-300';
        return (
          <span key={o.key + o.side} className={`rounded px-1.5 py-0.5 text-xs font-medium ${color}`}>
            {o.contracts}× {label} ${o.strike} · {o.expiry.slice(5).replace('-', '/')}
          </span>
        );
      })}
    </div>
  );
}

function PriceCell({ row, onOverride }: { row: PositionRow; onOverride: (t: string, p: number | null) => void }) {
  const edit = () => {
    const input = window.prompt(`Manual price for ${row.ticker} (leave blank to use Yahoo):`, row.price?.toFixed(2) ?? '');
    if (input === null) return;
    const n = parseFloat(input);
    onOverride(row.ticker, input.trim() === '' || Number.isNaN(n) ? null : n);
  };
  return (
    <button onClick={edit} className="text-right" title="Click to set a manual price">
      <div className={row.priceSource === 'manual' ? 'text-amber-600 dark:text-amber-400' : ''}>
        {row.price != null ? usd(row.price) : <span className="text-rose-500">set price</span>}
      </div>
      {row.priceSource === 'yahoo' && row.dayChangePct != null && (
        <div className={`text-xs ${plClass(row.dayChangePct)}`}>{pct(row.dayChangePct)} today</div>
      )}
      {row.priceSource === 'manual' && <div className="text-xs text-amber-600 dark:text-amber-400">manual</div>}
    </button>
  );
}
