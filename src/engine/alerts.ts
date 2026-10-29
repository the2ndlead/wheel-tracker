import type { OpenOption, Portfolio } from './types';

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface Alert {
  id: string;
  severity: AlertSeverity;
  ticker: string;
  title: string;
  detail: string;
  /** Open contract the alert is about, if any (lets the UI open the analyzer). */
  optionKey?: string;
}

export interface AlertInput {
  portfolio: Portfolio;
  /** Underlying price by ticker. */
  prices: Record<string, number | null | undefined>;
  /** Option mark (per share) by contract key. */
  marks: Record<string, number | null | undefined>;
  /** Days to expiry by contract key. */
  dte: (o: OpenOption) => number;
  /** e.g. 0.15 = alert when a position is down 15% vs true basis. */
  dropThreshold: number;
}

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usd = (n: number) => money.format(n);
const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

export function buildAlerts({ portfolio, prices, marks, dte, dropThreshold }: AlertInput): Alert[] {
  const alerts: Alert[] = [];
  const byTicker = new Map(portfolio.tickers.map((t) => [t.ticker, t]));

  for (const o of portfolio.openOptions) {
    const days = dte(o);
    const price = prices[o.underlying];
    const label = `${o.contracts}× ${o.underlying} $${o.strike} ${o.type.toLowerCase()} ${o.expiry}`;

    if (days < 0) {
      alerts.push({ id: `stale-${o.key}`, severity: 'info', ticker: o.underlying, optionKey: o.key, title: 'Expiry has passed', detail: `${label} still shows as open. Import a newer report.` });
      continue;
    }
    if (o.side === 'short' && price != null) {
      const itm = o.type === 'Put' ? price < o.strike : price > o.strike;
      if (itm) {
        alerts.push({
          id: `itm-${o.key}`,
          severity: days <= 7 ? 'critical' : 'warning',
          ticker: o.underlying,
          optionKey: o.key,
          title: o.type === 'Put' ? 'Put in the money: assignment risk' : 'Call in the money: shares may be called away',
          detail: `${label}: stock at ${usd(price)}, ${days} day${days === 1 ? '' : 's'} left.`,
        });
      }
    }
    if (days <= 7) {
      alerts.push({ id: `exp-${o.key}`, severity: 'info', ticker: o.underlying, optionKey: o.key, title: days === 0 ? 'Expires today' : `Expires in ${days} day${days === 1 ? '' : 's'}`, detail: label });
    }
    if (o.side === 'short' && o.type === 'Call') {
      const basis = byTicker.get(o.underlying)?.trueCostBasis;
      // In realized-only mode the basis doesn't include this call's own premium yet, so count it here:
      // if called away you receive the strike and keep the premium.
      const keep = portfolio.basis.realizedOnly ? o.cash / (100 * o.contracts) : 0;
      if (basis != null && o.strike + keep < basis) {
        alerts.push({
          id: `ccbasis-${o.key}`,
          severity: 'warning',
          ticker: o.underlying,
          optionKey: o.key,
          title: 'Covered call below true cost basis',
          detail: `${label}: if called you lock in a loss of ${usd(basis - o.strike - keep)}/share (true basis ${usd(basis)}${keep ? `, plus ${usd(keep)}/share premium kept` : ''}).`,
        });
      }
    }
    const mark = marks[o.key];
    if (o.side === 'short' && mark != null && o.cash > 0) {
      const captured = (o.cash - mark * 100 * o.contracts) / o.cash;
      if (captured >= 0.5) {
        alerts.push({
          id: `profit-${o.key}`,
          severity: 'info',
          ticker: o.underlying,
          optionKey: o.key,
          title: `${Math.floor(captured * 100)}% of max profit captured`,
          detail: `${label}: buy back for about ${usd(mark * 100 * o.contracts)} and keep ${usd(o.cash - mark * 100 * o.contracts)}. Consider closing.`,
        });
      }
    }
  }

  const collateral = portfolio.openOptions.filter((o) => o.side === 'short' && o.type === 'Put').reduce((s, o) => s + o.strike * 100 * o.contracts, 0);
  if (collateral > 0 && collateral > portfolio.cash + 0.005) {
    alerts.push({
      id: 'collateral',
      severity: 'critical',
      ticker: '',
      title: 'Not enough cash to cover your puts',
      detail: `Cash-secured puts need ${usd(collateral)} if all are assigned, but cash is ${usd(portfolio.cash)}.`,
    });
  }

  for (const t of portfolio.tickers) {
    const price = prices[t.ticker];
    if (t.shares <= 0 || price == null || t.trueCostBasis == null || t.trueCostBasis <= 0) continue;
    const change = price / t.trueCostBasis - 1;
    if (change <= -dropThreshold) {
      alerts.push({
        id: `drop-${t.ticker}`,
        severity: 'warning',
        ticker: t.ticker,
        title: `Down ${Math.abs(change * 100).toFixed(1)}% vs true cost basis`,
        detail: `${t.ticker} at ${usd(price)} vs true basis ${usd(t.trueCostBasis)} (${t.shares} shares).`,
      });
    }
  }

  return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.ticker.localeCompare(b.ticker));
}
