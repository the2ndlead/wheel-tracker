import { useState } from 'react';
import type { OpeningBalances, OpeningOption, OpeningPosition, OptionType } from '../engine/types';
import { Field, Modal, inputClass } from './Modal';

export interface OpeningPrefill {
  ticker: string;
  kind: 'shares' | 'option';
}

interface Props {
  value: OpeningBalances;
  /** Day before the first transaction, shown as the default as-of date. */
  defaultAsOf: string | null;
  prefill?: OpeningPrefill | null;
  /** Starting cash the app estimates when the field is left blank. */
  estimatedCash: number;
  /** Net cash from the imported file(s) alone, to back-solve from today's balance. */
  fileCash: number;
  onSave: (v: OpeningBalances) => void;
  onClose: () => void;
}

const num = (s: string) => (s.trim() === '' ? 0 : Number(s));
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export function OpeningBalancesDialog({ value, defaultAsOf, prefill, estimatedCash, fileCash, onSave, onClose }: Props) {
  const [asOf, setAsOf] = useState(value.asOf ?? '');
  const [cash, setCash] = useState(value.cash != null ? String(value.cash) : '');
  const [todayCash, setTodayCash] = useState('');
  const fromToday = todayCash.trim() !== '' && Number.isFinite(Number(todayCash)) ? Math.round((Number(todayCash) - fileCash) * 100) / 100 : null;
  const [positions, setPositions] = useState<OpeningPosition[]>(() => {
    const p = [...value.positions];
    if (prefill?.kind === 'shares' && !p.some((x) => x.ticker === prefill.ticker)) p.push({ ticker: prefill.ticker, shares: 0, costPerShare: 0 });
    return p;
  });
  const [options, setOptions] = useState<OpeningOption[]>(() => {
    const o = [...value.options];
    if (prefill?.kind === 'option') o.push({ ticker: prefill.ticker, type: 'Put', strike: 0, expiry: '', contracts: 1, premium: 0 });
    return o;
  });

  const setPos = (i: number, patch: Partial<OpeningPosition>) => setPositions((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const setOpt = (i: number, patch: Partial<OpeningOption>) => setOptions((os) => os.map((o, j) => (j === i ? { ...o, ...patch } : o)));

  const save = () => {
    onSave({
      asOf: asOf || null,
      cash: cash.trim() === '' ? null : num(cash),
      positions: positions.filter((p) => p.ticker.trim() && p.shares > 0).map((p) => ({ ...p, ticker: p.ticker.trim().toUpperCase() })),
      options: options.filter((o) => o.ticker.trim() && o.contracts > 0 && o.expiry && o.strike > 0).map((o) => ({ ...o, ticker: o.ticker.trim().toUpperCase() })),
    });
    onClose();
  };

  return (
    <Modal
      title="Opening balances"
      onClose={onClose}
      width="max-w-4xl"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">
        If your export doesn't start at the beginning of your account, enter what you held just before it starts. Your Robinhood monthly
        statement for that month lists the cash balance and positions. Without this, cash and account value come out too low.
      </p>

      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <Field label="As of" hint={defaultAsOf ? `Leave blank to use ${defaultAsOf} (day before your first transaction).` : undefined}>
          <input type="date" className={inputClass} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </Field>
        <Field
          label="Starting cash balance ($)"
          hint={
            estimatedCash > 0
              ? `Leave blank to estimate: ${money(estimatedCash)}, the least you could have started with, since cash can't go below $0.`
              : 'Leave blank if the export starts at the beginning of the account.'
          }
        >
          <input
            type="number"
            step="0.01"
            className={inputClass}
            value={cash}
            onChange={(e) => setCash(e.target.value)}
            placeholder={estimatedCash > 0 ? `Auto: ${estimatedCash.toFixed(2)}` : '0.00'}
          />
        </Field>
      </div>

      <div className="mb-6 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm dark:border-sky-500/30 dark:bg-sky-500/5">
        <div className="mb-2 font-medium">Don't know your starting cash? Match Robinhood instead</div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-600 dark:text-zinc-400">Cash shown in Robinhood today ($)</span>
            <input type="number" step="0.01" className={`${inputClass} w-44`} value={todayCash} onChange={(e) => setTodayCash(e.target.value)} placeholder="e.g. 16500.00" />
          </label>
          <button className="btn" disabled={fromToday == null} onClick={() => fromToday != null && setCash(String(fromToday))}>
            Use {fromToday != null ? money(fromToday) : '…'} as starting cash
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
          Use this account's cash balance in Robinhood, not buying power (buying power subtracts the collateral held for your puts). Starting cash
          = today's cash − the {money(fileCash)} net cash flow in your export. Only correct if your export runs up to today.
        </p>
      </div>

      <Section title="Stock positions" onAdd={() => setPositions([...positions, { ticker: '', shares: 0, costPerShare: 0 }])}>
        {positions.length > 0 && (
          <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-xs font-medium text-zinc-500">
            <span>Ticker</span>
            <span>Shares</span>
            <span>Cost / share ($)</span>
            <span />
          </div>
        )}
        {positions.map((p, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
            <input className={inputClass} value={p.ticker} onChange={(e) => setPos(i, { ticker: e.target.value.toUpperCase() })} placeholder="SOFI" autoFocus={prefill?.kind === 'shares' && p.ticker === prefill.ticker} />
            <input type="number" className={inputClass} value={p.shares || ''} onChange={(e) => setPos(i, { shares: num(e.target.value) })} />
            <input type="number" step="0.01" className={inputClass} value={p.costPerShare || ''} onChange={(e) => setPos(i, { costPerShare: num(e.target.value) })} />
            <button className="btn" onClick={() => setPositions(positions.filter((_, j) => j !== i))} aria-label="Remove">
              ✕
            </button>
          </div>
        ))}
      </Section>

      <Section title="Open short options (sold before the export starts)" onAdd={() => setOptions([...options, { ticker: '', type: 'Put', strike: 0, expiry: '', contracts: 1, premium: 0 }])}>
        {options.length > 0 && (
          <div className="grid grid-cols-[1fr_0.8fr_0.8fr_1.2fr_0.7fr_1fr_auto] gap-2 text-xs font-medium text-zinc-500">
            <span>Ticker</span>
            <span>Type</span>
            <span>Strike</span>
            <span>Expiry</span>
            <span>Contracts</span>
            <span>Credit received ($)</span>
            <span />
          </div>
        )}
        {options.map((o, i) => (
          <div key={i} className="grid grid-cols-[1fr_0.8fr_0.8fr_1.2fr_0.7fr_1fr_auto] gap-2">
            <input className={inputClass} value={o.ticker} onChange={(e) => setOpt(i, { ticker: e.target.value.toUpperCase() })} placeholder="SOFI" />
            <select className={inputClass} value={o.type} onChange={(e) => setOpt(i, { type: e.target.value as OptionType })}>
              <option>Put</option>
              <option>Call</option>
            </select>
            <input type="number" step="0.5" className={inputClass} value={o.strike || ''} onChange={(e) => setOpt(i, { strike: num(e.target.value) })} />
            <input type="date" className={inputClass} value={o.expiry} onChange={(e) => setOpt(i, { expiry: e.target.value })} />
            <input type="number" className={inputClass} value={o.contracts || ''} onChange={(e) => setOpt(i, { contracts: num(e.target.value) })} />
            <input type="number" step="0.01" className={inputClass} value={o.premium || ''} onChange={(e) => setOpt(i, { premium: num(e.target.value) })} />
            <button className="btn" onClick={() => setOptions(options.filter((_, j) => j !== i))} aria-label="Remove">
              ✕
            </button>
          </div>
        ))}
      </Section>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        Opening positions count as starting capital in "Total gain". An option's credit counts toward that ticker's wheel premium, but not
        toward cash, because it's already part of the cash balance above.
      </p>
    </Modal>
  );
}

function Section({ title, onAdd, children }: { title: string; onAdd: () => void; children: React.ReactNode }) {
  return (
    <div className="mb-5 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <button className="btn" onClick={onAdd}>
          + Add
        </button>
      </div>
      {children}
    </div>
  );
}
