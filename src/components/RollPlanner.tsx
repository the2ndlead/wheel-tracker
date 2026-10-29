import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { impliedVol } from '../engine/options';
import { todayIso } from '../engine/ledger';
import type { BasisOptions, Portfolio } from '../engine/types';
import type { ManualTrade } from '../parser/manual';
import { fetchChain, type OptionChain } from '../prices/yahoo';
import { formatDate, plClass, signedUsd, usd, usdShort } from '../lib/format';
import { compareRoll, currentContract, newContract, rollCurve, rollTrades, settleTrade, type Contract, type RollInput } from '../lib/roll';
import type { OptionRow } from '../lib/rows';
import { chartTheme } from './chartTheme';
import { Field, Modal, inputClass } from './Modal';

interface Props {
  row: OptionRow;
  dark: boolean;
  basis: BasisOptions;
  /** Account holding the contract (where a recorded roll goes). */
  accountName: string;
  /** Rebuilds the portfolio with extra trades added to that account. */
  simulate: (trades: ManualTrade[], basis: BasisOptions) => Portfolio | null;
  onRecord: (trades: ManualTrade[]) => void;
  onClose: () => void;
}

const num = (s: string) => (s.trim() === '' ? NaN : Number(s));
const money2 = (n: number | null | undefined) => (n == null ? '' : n.toFixed(2));
const contractText = (c: Contract) => `$${c.strike} ${c.type} · ${formatDate(c.expiry)}${c.contracts > 1 ? ` · ${c.contracts}×` : ''}`;
const pctText = (p: number | null) => (p == null ? '—' : `${Math.round(p * 100)}%`);

export function RollPlanner({ row: o, dark, basis, accountName, simulate, onRecord, onClose }: Props) {
  const c = chartTheme(dark);
  const today = todayIso();
  /** When the roll happens: today, or an earlier date to record a roll already made. */
  const [date, setDate] = useState(today);
  const past = date < today;
  const [chain, setChain] = useState<OptionChain | null>(null);
  const [expirations, setExpirations] = useState<string[]>([]);
  const [chainError, setChainError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [closePrice, setClosePrice] = useState(money2(o.mark));
  const [closeFees, setCloseFees] = useState('');
  const [newExpiry, setNewExpiry] = useState('');
  const [newStrike, setNewStrike] = useState(String(o.strike));
  const [newPremium, setNewPremium] = useState('');
  const [premiumAuto, setPremiumAuto] = useState(true);
  const [newContracts, setNewContracts] = useState(String(o.contracts));
  const [openFees, setOpenFees] = useState('');

  // Expiration list: any request returns all of them; the current expiry's request is cheap and cached by Yahoo.
  useEffect(() => {
    let live = true;
    fetchChain(o.underlying, o.expiry)
      .then((ch) => {
        if (!live) return;
        const later = ch.expirations.filter((e) => e > o.expiry);
        setExpirations(ch.expirations.filter((e) => e > today));
        setNewExpiry((cur) => cur || later[0] || '');
        const quote = (o.type === 'Put' ? ch.puts : ch.calls).find((x) => Math.abs(x.strike - o.strike) < 0.001);
        // Buying back fills nearer the ask than the mid; offer the ask when there's no saved mark.
        setClosePrice((cur) => cur || money2(quote?.ask ?? quote?.mark));
      })
      .catch((e) => live && setChainError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [o.underlying, o.expiry, o.strike, o.type, today]);

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newExpiry)) return;
    let live = true;
    setLoading(true);
    fetchChain(o.underlying, newExpiry)
      .then((ch) => {
        if (!live) return;
        setChain(ch);
        setChainError(null);
      })
      .catch((e) => {
        if (!live) return;
        setChain(null);
        setChainError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [o.underlying, newExpiry]);

  const contracts = (o.type === 'Put' ? chain?.puts : chain?.calls) ?? [];
  const quote = contracts.find((x) => Math.abs(x.strike - num(newStrike)) < 0.001);
  useEffect(() => {
    if (premiumAuto && quote?.mark != null) setNewPremium(money2(quote.mark));
  }, [premiumAuto, quote]);

  const price = o.price ?? chain?.underlyingPrice ?? null;
  const input: RollInput | null = useMemo(() => {
    const r = {
      option: o,
      date,
      closePrice: num(closePrice),
      closeFees: num(closeFees) || 0,
      newExpiry,
      newStrike: num(newStrike),
      newPremium: num(newPremium),
      newContracts: num(newContracts),
      openFees: num(openFees) || 0,
    };
    const ok = r.closePrice >= 0 && r.newStrike > 0 && r.newPremium > 0 && r.newContracts > 0 && Number.isInteger(r.newContracts) && /^\d{4}-\d{2}-\d{2}$/.test(date) && newExpiry > date;
    return ok ? r : null;
  }, [o, date, closePrice, closeFees, newExpiry, newStrike, newPremium, newContracts, openFees]);

  const problem = !input
    ? !(num(closePrice) >= 0)
      ? 'Enter the price to buy the current contract back.'
      : !/^\d{4}-\d{2}-\d{2}$/.test(date)
        ? 'Enter the roll date.'
        : !(newExpiry > date)
        ? 'Pick a new expiration after the roll date.'
        : !(num(newStrike) > 0)
          ? 'Pick a strike.'
          : !(num(newPremium) > 0)
            ? 'Enter the premium for the new contract.'
            : 'Enter a whole number of contracts.'
    : null;

  const ivRoll = useMemo(() => {
    if (!input || price == null) return quote?.iv ?? null;
    const dte = Math.max((Date.parse(input.newExpiry) - Date.parse(today)) / 86_400_000, 0.5);
    return impliedVol(o.type, input.newPremium, price, input.newStrike, dte / 365) ?? quote?.iv ?? null;
  }, [input, price, quote, o.type, today]);

  const cmp = useMemo(() => (input ? compareRoll(input, price, o.iv, ivRoll) : null), [input, price, o.iv, ivRoll]);
  const curve = useMemo(() => (cmp ? rollCurve(cmp, price) : []), [cmp, price]);

  // ---------- Cost basis, by replaying the trades through the engine ----------
  const sims = useMemo(() => {
    if (!input) return null;
    const ticker = o.underlying;
    const cur = currentContract(o);
    const next = newContract(input);
    const roll = rollTrades(input);
    const realized = { ...basis, realizedOnly: true };
    const position = (trades: ManualTrade[], b = basis) => simulate(trades, b)?.tickers.find((t) => t.ticker === ticker);
    const basisOf = (trades: ManualTrade[], b = basis) => position(trades, b)?.trueCostBasis ?? null;
    const held = position([])?.shares ?? 0;
    const holdExpires = basisOf([settleTrade(cur, 'expired')], realized);
    const rollExpires = basisOf([...roll, settleTrade(next, 'expired')], realized);
    // Called away: the shares sell at the strike; gain vs the true basis with every premium counted.
    const called = (c: Contract, b: number | null) => (b == null ? null : (c.strike - b) * Math.min(c.contracts * 100, held));
    return {
      now: basisOf([]),
      afterClose: basisOf([roll[0]]),
      afterRoll: basisOf(roll),
      holdAssigned: basisOf([settleTrade(cur, 'assigned')], realized),
      rollAssigned: basisOf([...roll, settleTrade(next, 'assigned')], realized),
      holdExpires,
      closeExpires: basisOf([roll[0]], realized),
      rollExpires,
      holdCalled: o.type === 'Call' ? called(cur, holdExpires) : null,
      rollCalled: o.type === 'Call' ? called(next, rollExpires) : null,
    };
  }, [input, o, basis, simulate]);

  const strikeOptions = useMemo(() => {
    const list = contracts.map((x) => x.strike);
    const cur = num(newStrike);
    if (cur > 0 && !list.some((s) => Math.abs(s - cur) < 0.001)) list.push(cur);
    return list.sort((a, b) => a - b);
  }, [contracts, newStrike]);

  const isPut = o.type === 'Put';
  const hasShares = sims?.now != null;
  const b = (n: number | null | undefined) => (n == null ? '—' : usd(n));

  return (
    <Modal
      title={
        <>
          Roll {o.underlying} ${o.strike} {o.type} · {formatDate(o.expiry)}{' '}
          <span className="text-sm font-normal text-zinc-500 dark:text-zinc-400">
            {o.contracts}× short · {o.dte} days left{price != null && ` · stock ${usd(price)}`}
          </span>
        </>
      }
      onClose={onClose}
      width="max-w-6xl"
      footer={
        <>
          <span className="mr-auto self-center text-xs text-zinc-500 dark:text-zinc-400">
            Recording adds a buy to close and a sell to open dated {date === today ? 'today' : formatDate(date)} to {accountName}'s manual trades.
          </span>
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn-primary" disabled={!input} onClick={() => input && onRecord(rollTrades(input))}>
            I made this roll, record it
          </button>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <Box title="1. Buy back the current contract">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Field label="Roll date" hint={past ? "Recording a roll you already made: enter the prices you actually got, not today's." : 'Change it to record a roll you made earlier.'}>
                <input type="date" max={today} className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
            </div>
            <Field label="Price / share ($)" hint={o.mark != null ? `Mark now ${usd(o.mark)}` : undefined}>
              <input type="number" step="0.01" min="0" className={inputClass} value={closePrice} onChange={(e) => setClosePrice(e.target.value)} />
            </Field>
            <Field label="Fees ($)">
              <input type="number" step="0.01" min="0" className={inputClass} value={closeFees} onChange={(e) => setCloseFees(e.target.value)} placeholder="0.00" />
            </Field>
          </div>
        </Box>

        <Box title={`2. Sell the new ${o.type.toLowerCase()}`}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Field label="Expiration">
              {expirations.length ? (
                <select
                  className={inputClass}
                  value={newExpiry}
                  onChange={(e) => {
                    setNewExpiry(e.target.value);
                    setPremiumAuto(true);
                  }}
                >
                  {expirations.map((e) => (
                    <option key={e} value={e} disabled={e <= date}>
                      {formatDate(e)}
                      {e === o.expiry ? ' (current)' : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <input type="date" className={inputClass} value={newExpiry} onChange={(e) => setNewExpiry(e.target.value)} />
              )}
            </Field>
            <Field label="Strike">
              {strikeOptions.length > 1 ? (
                <select
                  className={inputClass}
                  value={String(num(newStrike))}
                  onChange={(e) => {
                    setNewStrike(e.target.value);
                    setPremiumAuto(true);
                  }}
                >
                  {strikeOptions.map((s) => {
                    const q = contracts.find((x) => Math.abs(x.strike - s) < 0.001);
                    return (
                      <option key={s} value={String(s)}>
                        ${s}
                        {q?.bid != null && q.ask != null ? ` · ${q.bid.toFixed(2)}/${q.ask.toFixed(2)}` : ''}
                      </option>
                    );
                  })}
                </select>
              ) : (
                <input type="number" step="0.5" min="0" className={inputClass} value={newStrike} onChange={(e) => setNewStrike(e.target.value)} />
              )}
            </Field>
            <Field label="Premium / share ($)" hint={quote ? `Bid ${money2(quote.bid) || '—'} · Ask ${money2(quote.ask) || '—'}` : loading ? 'Loading prices…' : undefined}>
              <input
                type="number"
                step="0.01"
                min="0"
                className={inputClass}
                value={newPremium}
                onChange={(e) => {
                  setNewPremium(e.target.value);
                  setPremiumAuto(false);
                }}
              />
            </Field>
            <Field label="Contracts">
              <input type="number" step="1" min="1" className={inputClass} value={newContracts} onChange={(e) => setNewContracts(e.target.value)} />
            </Field>
            <Field label="Fees ($)">
              <input type="number" step="0.01" min="0" className={inputClass} value={openFees} onChange={(e) => setOpenFees(e.target.value)} placeholder="0.00" />
            </Field>
          </div>
          {chainError && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">Couldn't load the option chain ({chainError}). Enter the expiration, strike and premium yourself.</p>}
        </Box>
      </div>

      {problem && <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">{problem}</p>}

      {cmp && sims && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={cmp.netCredit >= 0 ? 'Net credit for the roll' : 'Net debit for the roll'} value={signedUsd(cmp.netCredit)} className={plClass(cmp.netCredit)} sub="new premium − buyback, after fees" />
            <Stat label="Time added" value={`${cmp.roll.days - cmp.hold.days >= 0 ? '+' : ''}${cmp.roll.days - cmp.hold.days} days`} sub={`${cmp.hold.days} → ${cmp.roll.days} days to expiry`} />
            <Stat
              label="Strike"
              value={`$${o.strike} → $${input!.newStrike}`}
              sub={
                input!.newStrike === o.strike
                  ? 'same strike'
                  : (isPut ? input!.newStrike < o.strike : input!.newStrike > o.strike)
                    ? isPut
                      ? 'rolled down: lower assignment price'
                      : 'rolled up: more upside on the shares'
                    : isPut
                      ? 'rolled up: higher assignment price'
                      : 'rolled down: sells the shares cheaper'
              }
            />
            <Stat label="Net credit, annualized" value={cmp.annualizedNet == null ? '—' : `${(cmp.annualizedNet * 100).toFixed(1)}%`} sub="on the new strike value, for the days added" />
          </div>

          <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              <thead className="bg-zinc-50 dark:bg-zinc-900">
                <tr>
                  <th className="th" />
                  <th className="th num">Close now</th>
                  <th className="th num">Keep current</th>
                  <th className="th num bg-sky-50 text-sky-800 dark:bg-sky-500/10 dark:text-sky-300">Roll</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
                <Row label="Contract" cells={['—', contractText(cmp.hold.contract!), contractText(cmp.roll.contract!)]} />
                <Row label="Cash today" cells={[cmp.close.cashToday, cmp.hold.cashToday, cmp.roll.cashToday].map(signedUsd)} classes={[cmp.close.cashToday, 0, cmp.roll.cashToday].map(plClass)} />
                <Row
                  label="Option P/L if it expires worthless"
                  hint="since you sold the current contract"
                  cells={[cmp.close.maxPL, cmp.hold.maxPL, cmp.roll.maxPL].map(signedUsd)}
                  classes={[cmp.close.maxPL, cmp.hold.maxPL, cmp.roll.maxPL].map(plClass)}
                />
                <Row
                  label={`Option P/L if the stock is ${price != null ? usd(price) : 'unchanged'} at expiry`}
                  cells={[cmp.close.plAtPrice, cmp.hold.plAtPrice, cmp.roll.plAtPrice].map((v) => (v == null ? '—' : signedUsd(v)))}
                  classes={[cmp.close.plAtPrice, cmp.hold.plAtPrice, cmp.roll.plAtPrice].map(plClass)}
                />
                <Row label="Breakeven at expiry" cells={['—', b(cmp.hold.breakeven), b(cmp.roll.breakeven)]} />
                <Row label="Chance of profit (model)" cells={['—', pctText(cmp.hold.probProfit), pctText(cmp.roll.probProfit)]} />

                <tr>
                  <td colSpan={4} className="bg-zinc-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                    True cost basis per share
                  </td>
                </tr>
                {hasShares && (
                  <Row
                    label="Right after the trade"
                    hint={basis.realizedOnly ? 'realized only: open premium not counted yet' : 'including premium from open contracts'}
                    cells={[b(sims.afterClose), b(sims.now), b(sims.afterRoll)]}
                    emphasize
                  />
                )}
                {isPut ? (
                  <Row
                    label="If the put is assigned"
                    hint={hasShares ? 'new shares blended with the ones you hold' : 'the shares you would own, after all premium'}
                    cells={['—', b(sims.holdAssigned), b(sims.rollAssigned)]}
                    emphasize={!hasShares}
                  />
                ) : (
                  <>
                    <Row label="If the call expires worthless" hint="you keep the shares and the premium" cells={[b(sims.closeExpires), b(sims.holdExpires), b(sims.rollExpires)]} emphasize />
                    <Row
                      label="If the shares are called away"
                      hint="(strike − true basis with all premium) × shares sold"
                      cells={['—', sims.holdCalled == null ? '—' : signedUsd(sims.holdCalled), sims.rollCalled == null ? '—' : signedUsd(sims.rollCalled)]}
                      classes={['', plClass(sims.holdCalled), plClass(sims.rollCalled)]}
                    />
                  </>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4">
            <div className="mb-1 text-sm font-medium">Option P/L at expiry, keep vs roll</div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={curve} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid vertical={false} stroke={c.grid} />
                  <XAxis dataKey="price" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v: number) => `$${v.toFixed(0)}`} tick={{ fill: c.axis, fontSize: 12 }} axisLine={{ stroke: c.grid }} tickLine={false} />
                  <YAxis tickFormatter={usdShort} tick={{ fill: c.axis, fontSize: 12 }} axisLine={false} tickLine={false} width={72} />
                  <Tooltip
                    contentStyle={{ background: c.tooltipBg, border: `1px solid ${c.tooltipBorder}`, borderRadius: 8, color: c.text }}
                    labelStyle={{ color: c.text }}
                    labelFormatter={(v: number) => `Stock at ${usd(v)} at expiry`}
                    formatter={(v: number, name: string) => [signedUsd(v), name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: c.axis }} />
                  <ReferenceLine y={0} stroke={c.axis} strokeOpacity={0.6} />
                  {price != null && <ReferenceLine x={price} stroke={c.axis} strokeDasharray="4 4" label={{ value: 'Now', fill: c.axis, fontSize: 11, position: 'top' }} />}
                  <Line type="linear" dataKey="hold" name={`Keep current (${formatDate(o.expiry)})`} stroke={c.series1} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                  <Line type="linear" dataKey="roll" name={`Roll (${formatDate(input!.newExpiry)})`} stroke={c.series2} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              P/L includes the premium from the contract you sold originally, so both lines start from the same trade. The two lines settle on
              different dates. Chance of profit is a model estimate from implied volatility.{' '}
              {!basis.realizedOnly || !hasShares ? '' : 'Switch to "Include open contracts" to see the basis with the new premium counted right away.'}
            </p>
          </div>
        </>
      )}
    </Modal>
  );
}

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
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

function Row({ label, hint, cells, classes, emphasize }: { label: string; hint?: string; cells: string[]; classes?: string[]; emphasize?: boolean }) {
  return (
    <tr>
      <td className="td">
        <div className={emphasize ? 'font-medium' : ''}>{label}</div>
        {hint && <div className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</div>}
      </td>
      {cells.map((v, i) => (
        <td key={i} className={`td num ${i === 2 ? 'bg-sky-50/60 dark:bg-sky-500/5' : ''} ${emphasize ? 'font-semibold' : ''} ${classes?.[i] ?? ''}`}>
          {v}
        </td>
      ))}
    </tr>
  );
}
