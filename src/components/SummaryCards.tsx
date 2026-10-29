import type { ReactNode } from 'react';
import { pct, plClass, signedUsd, usd } from '../lib/format';

export interface Summary {
  accountValue: number;
  cash: number;
  cspCollateral: number;
  stockValue: number;
  /** Long options at market (cost when no quote). */
  longOptionsValue: number;
  /** Cost to buy back open short options (premium when no quote). */
  shortOptionsLiability: number;
  netDeposits: number;
  openingCapital: number;
  openingCash: number;
  openingCashEstimated: boolean;
  totalGain: number;
  unrealizedTrue: number;
  totalPremium: number;
  premiumThisMonth: number;
  missingPrices: number;
  missingMarks: number;
}

function Card({ label, value, sub, valueClass, title }: { label: string; value: string; sub?: ReactNode; valueClass?: string; title?: string }) {
  return (
    <div className="card p-4" title={title}>
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${valueClass ?? ''}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{sub}</div>}
    </div>
  );
}

/** `onOpening` is omitted in the combined view, where opening balances are set per account. */
export function SummaryCards({ s, onOpening, combined }: { s: Summary; onOpening?: () => void; combined?: boolean }) {
  const gainPct = s.netDeposits > 0 ? s.totalGain / s.netDeposits : null;
  const missing = [s.missingPrices && `${s.missingPrices} stock price(s)`, s.missingMarks && `${s.missingMarks} option quote(s)`].filter(Boolean).join(', ');
  return (
    <div className="space-y-2">
      {s.openingCashEstimated && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-sky-200 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/5 dark:text-sky-100">
          <span>
            {combined ? (
              <>
                ℹ Starting cash of <b>{usd(s.openingCash)}</b> includes estimates for accounts whose export doesn't show the cash they started with.
                To make it exact, switch to that account and use Opening balances.
              </>
            ) : (
              <>
                ℹ Your export doesn't include the cash you started with, so it's <b>estimated at {usd(s.openingCash)}</b>: the least you
                could have had, since cash can never go below $0. For an exact match, enter your cash balance from Robinhood.
              </>
            )}
          </span>
          {onOpening && (
            <button className="btn" onClick={onOpening}>
              Set exact amount
            </button>
          )}
        </div>
      )}
      {s.cash < -0.5 && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/5 dark:text-amber-200">
          <span>
            ⚠ Cash comes out at <b>{usd(s.cash)}</b>, so your export probably starts partway through your account history. Add the cash balance and
            positions you had when it starts so account value is correct.
          </span>
          {onOpening && (
            <button className="btn-primary" onClick={onOpening}>
              Add opening balances
            </button>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Card
          label="Account value"
          value={usd(s.accountValue)}
          title="Cash + stock at market + long options at market − cost to buy back open short options"
          sub={missing ? `missing ${missing}, using cost` : 'stock & options at market'}
        />
        <Card label="Cash" value={usd(s.cash)} sub={s.cspCollateral > 0 ? `${usd(s.cspCollateral)} reserved for CSPs` : 'no open CSPs'} />
        <Card
          label="Stock value"
          value={usd(s.stockValue)}
          sub={
            s.longOptionsValue || s.shortOptionsLiability
              ? `options: +${usd(s.longOptionsValue)} long, −${usd(s.shortOptionsLiability)} short`
              : 'at current prices'
          }
        />
        <Card
          label="Total gain"
          value={signedUsd(s.totalGain)}
          valueClass={plClass(s.totalGain)}
          title="Account value minus deposits (and opening balances)"
          sub={`${pct(gainPct)} on ${usd(s.netDeposits)} ${s.openingCapital ? 'deposits + opening' : 'net deposits'}`}
        />
        <Card label="Unrealized vs true basis" value={signedUsd(s.unrealizedTrue)} valueClass={plClass(s.unrealizedTrue)} sub="open stock positions" />
        <Card
          label="Wheel premium"
          value={usd(s.totalPremium)}
          valueClass={plClass(s.totalPremium)}
          title="All short put and call premium, net of buy-to-close"
          sub={`${signedUsd(s.premiumThisMonth)} this month`}
        />
      </div>
    </div>
  );
}
