import { useMemo, useState } from 'react';
import type { OpenOption, OptionType } from '../engine/types';
import { ACTIONS, actionKind, hasPrice, manualToTransactions, validateManualTrade, type ManualAction, type ManualTrade } from '../parser/manual';
import { formatDate, signedUsd } from '../lib/format';
import { Field, Modal, inputClass } from './Modal';

interface Props {
  trades: ManualTrade[];
  /** Open contracts, offered as a shortcut when closing one. */
  openOptions: OpenOption[];
  tickers: string[];
  onSave: (trades: ManualTrade[]) => void;
  onClose: () => void;
}

interface Form {
  action: ManualAction;
  date: string;
  ticker: string;
  type: OptionType;
  strike: string;
  expiry: string;
  quantity: string;
  price: string;
  fees: string;
  amount: string;
  note: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const blank = (keep?: Partial<Form>): Form => ({
  action: 'sto',
  date: today(),
  ticker: '',
  type: 'Put',
  strike: '',
  expiry: '',
  quantity: '',
  price: '',
  fees: '',
  amount: '',
  note: '',
  ...keep,
});
const num = (s: string) => (s.trim() === '' ? 0 : Number(s));

/** Which open contracts an action can close: short ones for BTC/assigned, long for STC/exercised, any for expired. */
const closes: Partial<Record<ManualAction, OpenOption['side'] | 'any'>> = { btc: 'short', assigned: 'short', stc: 'long', exercised: 'long', expired: 'any' };

function toTrade(f: Form, id: string): ManualTrade {
  const kind = actionKind(f.action);
  return {
    id,
    date: f.date,
    action: f.action,
    ticker: f.ticker.trim().toUpperCase(),
    quantity: kind === 'cash' ? 0 : num(f.quantity),
    price: hasPrice(f.action) ? num(f.price) : 0,
    fees: kind === 'cash' ? 0 : num(f.fees),
    option: kind === 'option' ? { type: f.type, strike: num(f.strike), expiry: f.expiry } : undefined,
    amount: kind === 'cash' ? num(f.amount) : 0,
    note: f.note.trim() || undefined,
  };
}

function toForm(t: ManualTrade): Form {
  const s = (n: number) => (n ? String(n) : '');
  return {
    action: t.action,
    date: t.date,
    ticker: t.ticker,
    type: t.option?.type ?? 'Put',
    strike: s(t.option?.strike ?? 0),
    expiry: t.option?.expiry ?? '',
    quantity: s(t.quantity),
    price: s(t.price),
    fees: s(t.fees),
    amount: s(t.amount),
    note: t.note ?? '',
  };
}

const label = (a: ManualAction) => ACTIONS.find((x) => x.value === a)!.label.replace(/ \(.*\)$/, '');
const contractLabel = (o: OpenOption) => `${o.side === 'short' ? 'Short' : 'Long'} ${o.contracts}× ${o.underlying} ${formatDate(o.expiry)} ${o.type} $${o.strike}`;

export function ManualTradesDialog({ trades, openOptions, tickers, onSave, onClose }: Props) {
  const [form, setForm] = useState<Form>(() => blank());
  const [editing, setEditing] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  const kind = actionKind(form.action);
  const draft = toTrade(form, editing ?? '');
  const problem = validateManualTrade(draft);
  const cash = problem ? null : manualToTransactions(draft).reduce((s, t) => s + t.amount, 0);

  const side = closes[form.action];
  const closable = useMemo(
    () => (side ? openOptions.filter((o) => side === 'any' || o.side === side).sort((a, b) => a.underlying.localeCompare(b.underlying) || a.expiry.localeCompare(b.expiry)) : []),
    [openOptions, side],
  );

  const submit = () => {
    setTouched(true);
    if (problem) return;
    if (editing) onSave(trades.map((t) => (t.id === editing ? toTrade(form, editing) : t)));
    else onSave([...trades, toTrade(form, Math.random().toString(36).slice(2, 10))]);
    setEditing(null);
    setTouched(false);
    // Keep the action, date and ticker: trades are often entered in runs.
    setForm(blank({ action: form.action, date: form.date, ticker: kind === 'cash' && form.action !== 'dividend' ? '' : form.ticker }));
  };

  const sorted = [...trades].sort((a, b) => b.date.localeCompare(a.date) || trades.indexOf(b) - trades.indexOf(a));

  return (
    <Modal
      title="Trades entered by hand"
      onClose={onClose}
      width="max-w-5xl"
      footer={
        <button className="btn-primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">
        Add trades your Robinhood export doesn't have yet (e.g. today's fills) or trades from another broker. They count exactly like imported
        ones. Once a newer export includes a trade, delete it here so it isn't counted twice. The app warns you when it spots one.
      </p>

      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{editing ? 'Edit trade' : 'Add a trade'}</h3>
          {editing && (
            <button
              className="btn"
              onClick={() => {
                setEditing(null);
                setTouched(false);
                setForm(blank());
              }}
            >
              Cancel edit
            </button>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <Field label="What happened">
            <select className={inputClass} value={form.action} onChange={(e) => set({ action: e.target.value as ManualAction })}>
              {(['option', 'stock', 'cash'] as const).map((k) => (
                <optgroup key={k} label={k === 'option' ? 'Options' : k === 'stock' ? 'Shares' : 'Cash'}>
                  {ACTIONS.filter((a) => a.kind === k).map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <input type="date" className={inputClass} value={form.date} onChange={(e) => set({ date: e.target.value })} />
          </Field>
        </div>

        {closable.length > 0 && (
          <div className="mt-3">
            <Field label="Fill in from an open contract (optional)">
              <select
                className={inputClass}
                value=""
                onChange={(e) => {
                  const o = closable[Number(e.target.value)];
                  if (o) set({ ticker: o.underlying, type: o.type, strike: String(o.strike), expiry: o.expiry, quantity: String(o.contracts) });
                }}
              >
                <option value="">Choose a contract…</option>
                {closable.map((o, i) => (
                  <option key={o.key} value={i}>
                    {contractLabel(o)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}

        <datalist id="manual-tickers">
          {tickers.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {(kind !== 'cash' || form.action === 'dividend') && (
            <Field label="Ticker">
              <input className={inputClass} list="manual-tickers" value={form.ticker} onChange={(e) => set({ ticker: e.target.value.toUpperCase() })} placeholder="SOFI" />
            </Field>
          )}
          {kind === 'option' && (
            <>
              <Field label="Type">
                <select className={inputClass} value={form.type} onChange={(e) => set({ type: e.target.value as OptionType })}>
                  <option>Put</option>
                  <option>Call</option>
                </select>
              </Field>
              <Field label="Strike ($)">
                <input type="number" step="0.5" min="0" className={inputClass} value={form.strike} onChange={(e) => set({ strike: e.target.value })} />
              </Field>
              <Field label="Expiration">
                <input type="date" className={inputClass} value={form.expiry} onChange={(e) => set({ expiry: e.target.value })} />
              </Field>
            </>
          )}
          {kind !== 'cash' && (
            <Field label={kind === 'option' ? 'Contracts' : 'Shares'}>
              <input type="number" step={kind === 'option' ? '1' : 'any'} min="0" className={inputClass} value={form.quantity} onChange={(e) => set({ quantity: e.target.value })} />
            </Field>
          )}
          {hasPrice(form.action) && (
            <Field label={kind === 'option' ? 'Premium / share ($)' : 'Price / share ($)'}>
              <input type="number" step="0.01" min="0" className={inputClass} value={form.price} onChange={(e) => set({ price: e.target.value })} placeholder={kind === 'option' ? '1.25' : ''} />
            </Field>
          )}
          {kind !== 'cash' && (
            <Field label="Fees ($)">
              <input type="number" step="0.01" min="0" className={inputClass} value={form.fees} onChange={(e) => set({ fees: e.target.value })} placeholder="0.00" />
            </Field>
          )}
          {kind === 'cash' && (
            <Field label="Amount ($)">
              <input type="number" step="0.01" min="0" className={inputClass} value={form.amount} onChange={(e) => set({ amount: e.target.value })} />
            </Field>
          )}
        </div>

        <div className="mt-3">
          <Field label="Note (optional)">
            <input className={inputClass} value={form.note} onChange={(e) => set({ note: e.target.value })} placeholder="e.g. rolled from the $20 put" />
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            {touched && problem ? (
              <span className="text-rose-600 dark:text-rose-400">{problem}</span>
            ) : cash != null ? (
              <span className="text-zinc-600 dark:text-zinc-300">
                Cash effect: <span className="font-medium tabular-nums">{cash ? signedUsd(cash) : '$0.00'}</span>
                {kind === 'option' && hasPrice(form.action) && ` · $${(num(form.price) * 100).toFixed(2)} per contract`}
                {(form.action === 'assigned' || form.action === 'exercised') &&
                  ` · ${(form.action === 'assigned') === (form.type === 'Put') ? 'buys' : 'sells'} ${num(form.quantity) * 100} shares at $${form.strike}`}
              </span>
            ) : (
              <span className="text-zinc-500 dark:text-zinc-400">{kind === 'option' && hasPrice(form.action) ? 'Premium is per share, as Robinhood shows it: $1.25 = $125 a contract.' : ''}</span>
            )}
          </div>
          <button className="btn-primary" onClick={submit}>
            {editing ? 'Save changes' : 'Add trade'}
          </button>
        </div>
      </div>

      <h3 className="mb-2 mt-6 text-sm font-semibold">
        Your manual trades {trades.length > 0 && <span className="font-normal text-zinc-500">({trades.length})</span>}
      </h3>
      {trades.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">None yet.</p>
      ) : (
        <div className="max-h-80 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
            <thead className="sticky top-0 bg-white dark:bg-zinc-900">
              <tr>
                <th className="th">Date</th>
                <th className="th">Action</th>
                <th className="th">Details</th>
                <th className="th num">Cash</th>
                <th className="th">Note</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
              {sorted.map((t) => {
                const rows = manualToTransactions(t);
                const amount = rows.reduce((s, r) => s + r.amount, 0);
                const k = actionKind(t.action);
                const details =
                  k === 'cash'
                    ? rows[0].description
                    : `${t.quantity} ${k === 'option' ? (t.quantity === 1 ? 'contract' : 'contracts') : 'sh'} · ${k === 'option' ? rows[0].description : t.ticker}${t.price ? ` @ $${t.price}` : ''}${t.fees ? ` · fees $${t.fees}` : ''}`;
                return (
                  <tr key={t.id} className={editing === t.id ? 'bg-sky-50 dark:bg-sky-500/10' : ''}>
                    <td className="td whitespace-nowrap">{formatDate(t.date)}</td>
                    <td className="td whitespace-nowrap">{label(t.action)}</td>
                    <td className="td">{details}</td>
                    <td className="td num whitespace-nowrap">{amount ? signedUsd(amount) : ''}</td>
                    <td className="td max-w-[12rem] truncate text-xs text-zinc-500" title={t.note}>
                      {t.note}
                    </td>
                    <td className="td whitespace-nowrap text-right">
                      <button
                        className="btn mr-1"
                        onClick={() => {
                          setEditing(t.id);
                          setTouched(false);
                          setForm(toForm(t));
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="btn"
                        aria-label={`Delete ${label(t.action)} on ${t.date}`}
                        onClick={() => {
                          if (!window.confirm(`Delete this trade (${label(t.action)} on ${formatDate(t.date)})?`)) return;
                          onSave(trades.filter((x) => x.id !== t.id));
                          if (editing === t.id) {
                            setEditing(null);
                            setForm(blank());
                          }
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
