const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usdWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export const usd = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : usdFmt.format(n));
export const usdShort = (n: number) => usdWhole.format(n);
export const signedUsd = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '—' : `${n > 0 ? '+' : ''}${usdFmt.format(n)}`;
export const pct = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '—' : `${n > 0 ? '+' : ''}${(n * 100).toFixed(2)}%`;
export const qty = (n: number) => (Number.isInteger(n) ? n.toString() : n.toFixed(4).replace(/0+$/, ''));

/** Text color for a gain/loss figure. */
export const plClass = (n: number | null | undefined) =>
  n == null || Math.abs(n) < 0.005
    ? 'text-zinc-500 dark:text-zinc-400'
    : n > 0
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-rose-600 dark:text-rose-400';

export const formatDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
};
