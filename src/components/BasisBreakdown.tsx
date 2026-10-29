import { useMemo, useState } from 'react';
import type { BasisItem, BasisOptions, TickerPosition } from '../engine/types';
import { formatDate, plClass, qty, signedUsd, usd } from '../lib/format';
import { Modal } from './Modal';

interface Props {
  position: TickerPosition;
  basis: BasisOptions;
  onClose: () => void;
}

const KIND_LABEL: Record<BasisItem['kind'], string> = { put: 'Put', call: 'Call', dividend: 'Dividend', longOption: 'Long option' };

function label(i: BasisItem) {
  if (i.kind === 'dividend') return 'Dividend';
  if (i.kind === 'longOption') return 'Long option P/L';
  if (i.code === 'BTC') return `${KIND_LABEL[i.kind]} bought back`;
  return `${KIND_LABEL[i.kind]} premium`;
}

function status(i: BasisItem, b: BasisOptions, currentCycle: number | null): { text: string; cls: string } {
  const near = (x: number, y: number) => Math.abs(x - y) < 0.005;
  if (near(i.counted, i.amount) && !near(i.amount, 0)) return { text: 'Counted', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300' };
  if ((i.kind === 'dividend' && !b.includeDividends) || (i.kind === 'longOption' && !b.includeLongOptions))
    return { text: 'Off in settings', cls: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700/50 dark:text-zinc-400' };
  if (b.scope === 'currentCycle' && i.cycle !== currentCycle) return { text: 'Earlier cycle', cls: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700/50 dark:text-zinc-400' };
  if (b.realizedOnly && i.openAmount > 0.005)
    return near(i.counted, 0)
      ? { text: 'Still open: not counted yet', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300' }
      : { text: 'Partly open', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300' };
  return { text: '—', cls: '' };
}

/** Which trades lowered (or raised) a position's true cost basis, under the active settings. */
export function BasisBreakdown({ position: p, basis, onClose }: Props) {
  const [onlyCounted, setOnlyCounted] = useState(false);
  const currentCycle = p.cycles.find((c) => c.status === 'open')?.index ?? null;

  const rows = useMemo(() => {
    let running = 0;
    return p.basisItems.map((i) => {
      running += i.counted;
      return { item: i, running };
    });
  }, [p.basisItems]);
  const showAccount = p.basisItems.some((i) => i.source);
  const visible = onlyCounted ? rows.filter((r) => Math.abs(r.item.counted) > 0.005) : rows;

  const sum = (f: (i: BasisItem) => boolean) => p.basisItems.filter(f).reduce((s, i) => s + i.counted, 0);
  const parts = [
    { label: 'Put premium (net of buybacks)', value: sum((i) => i.kind === 'put') },
    { label: 'Covered call premium (net of buybacks)', value: sum((i) => i.kind === 'call') },
    { label: 'Dividends', value: sum((i) => i.kind === 'dividend'), hide: !basis.includeDividends },
    { label: 'Long option P/L', value: sum((i) => i.kind === 'longOption'), hide: !basis.includeLongOptions },
  ].filter((x) => !x.hide);
  const notCountedOpen = p.basisItems.reduce((s, i) => s + (basis.realizedOnly ? i.openAmount : 0), 0);
  const shares = p.shares;
  const perShare = (n: number) => (shares > 0 ? n / shares : 0);

  return (
    <Modal title={`${p.ticker}: what's lowering your cost basis`} onClose={onClose} width="max-w-6xl">
      {shares > 0 ? (
        <div className="mb-5 grid gap-4 md:grid-cols-[1fr_1fr]">
          <div className="rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
            <table className="w-full tabular-nums">
              <tbody>
                <tr>
                  <td className="py-1">Cost of {qty(shares)} shares held</td>
                  <td className="py-1 text-right">{usd(p.costRaw)}</td>
                  <td className="py-1 pl-4 text-right text-zinc-500">{usd(p.avgCost)}/sh</td>
                </tr>
                {parts.map((x) => (
                  <tr key={x.label}>
                    <td className="py-1">− {x.label}</td>
                    <td className={`py-1 text-right ${plClass(x.value)}`}>{usd(-x.value)}</td>
                    <td className="py-1 pl-4 text-right text-zinc-500">{usd(-perShare(x.value))}/sh</td>
                  </tr>
                ))}
                <tr className="border-t border-zinc-200 font-semibold dark:border-zinc-700">
                  <td className="pt-2">= True cost basis</td>
                  <td className="pt-2 text-right">{usd(p.costRaw - p.basisReduction)}</td>
                  <td className="pt-2 pl-4 text-right">{usd(p.trueCostBasis)}/sh</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="space-y-2 text-sm text-zinc-600 dark:text-zinc-300">
            <p>
              Your basis is <b>{usd(p.basisReduction)}</b> lower than what you paid, or <b>{usd(perShare(p.basisReduction))}/share</b>, from the trades
              marked <i>Counted</i> below.
            </p>
            {basis.realizedOnly && notCountedOpen > 0.005 && (
              <p className="rounded-lg bg-sky-50 p-2 text-sky-900 dark:bg-sky-500/10 dark:text-sky-200">
                {usd(notCountedOpen)} of premium is from contracts that are still open, so it isn't counted yet ({usd(perShare(notCountedOpen))}/share).
                It will count once they expire, are assigned, or are bought back. Switch to <b>Include open</b> to count it now.
              </p>
            )}
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Settings: {basis.scope === 'all' ? 'all premium on the ticker' : 'current wheel cycle only'} ·{' '}
              {basis.realizedOnly ? 'realized only' : 'including open contracts'}
              {basis.includeDividends ? ' · dividends' : ''}
              {basis.includeLongOptions ? ' · long options' : ''}
            </p>
          </div>
        </div>
      ) : (
        <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">You don't hold {p.ticker} right now, so there's no cost basis. These are the trades that would count.</p>
      )}

      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-medium">Trades ({visible.length})</div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-sky-600" checked={onlyCounted} onChange={(e) => setOnlyCounted(e.target.checked)} />
          Only show trades that count
        </label>
      </div>
      <div className="max-h-[50vh] overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
          <thead className="sticky top-0 bg-white dark:bg-zinc-900">
            <tr>
              <th className="th">Date</th>
              {showAccount && <th className="th">Account</th>}
              <th className="th">Type</th>
              <th className="th">Contract / detail</th>
              <th className="th num">Cash</th>
              <th className="th num">Lowers basis by</th>
              <th className="th num">Per share</th>
              <th className="th num">Running total</th>
              <th className="th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
            {visible.map(({ item: i, running }, idx) => {
              const s = status(i, basis, currentCycle);
              return (
                <tr key={idx} className={Math.abs(i.counted) < 0.005 ? 'opacity-60' : ''}>
                  <td className="td">{formatDate(i.date)}</td>
                  {showAccount && <td className="td text-xs">{i.source}</td>}
                  <td className="td">{label(i)}</td>
                  <td className="td max-w-[15rem] truncate" title={i.cycle != null ? `${i.description} (wheel cycle ${i.cycle})` : i.description}>
                    {i.description}
                  </td>
                  <td className={`td num ${plClass(i.amount)}`}>{signedUsd(i.amount)}</td>
                  <td className={`td num font-medium ${plClass(i.counted)}`}>{Math.abs(i.counted) < 0.005 ? '—' : usd(i.counted)}</td>
                  <td className="td num text-zinc-500">{Math.abs(i.counted) < 0.005 || !shares ? '' : usd(perShare(i.counted))}</td>
                  <td className="td num">{usd(running)}</td>
                  <td className="td">{s.cls ? <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${s.cls}`}>{s.text}</span> : s.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        A positive amount lowers the basis: premium received, dividends. A negative one raises it: buyback costs, long-option losses. Exercised
        long-option premium is part of the share cost itself, so it isn't listed here.
      </p>
    </Modal>
  );
}
