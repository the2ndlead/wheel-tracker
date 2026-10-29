import { useState } from 'react';
import type { ImportNote } from '../engine/types';
import type { OpeningPrefill } from './OpeningBalancesDialog';

interface Props {
  warnings: ImportNote[];
  /** Omitted in the combined view, where opening balances are set per account. */
  onFix?: (prefill: OpeningPrefill) => void;
}

export function WarningsPanel({ warnings, onFix }: Props) {
  const [open, setOpen] = useState(false);
  if (!warnings.length) return null;
  const fixable = warnings.filter((w) => w.action).length;
  return (
    <div className="card border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/5">
      <button className="flex w-full items-center justify-between px-4 py-3 text-left text-sm" onClick={() => setOpen(!open)}>
        <span className="font-medium text-amber-800 dark:text-amber-300">
          ⚠ {warnings.length} import note{warnings.length > 1 ? 's' : ''}
          {fixable > 0 && ` · ${fixable} fixable with opening balances`}
        </span>
        <span className="text-amber-700 dark:text-amber-400">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <ul className="space-y-1.5 px-4 pb-4 text-sm text-amber-900 dark:text-amber-200/80">
          {warnings.map((w, i) => (
            <li key={i} className="flex items-start justify-between gap-3">
              <span>• {w.text}</span>
              {onFix && w.action && w.ticker && (
                <button
                  className="btn shrink-0 whitespace-nowrap px-2 py-0.5 text-xs"
                  onClick={() => onFix({ ticker: w.ticker!, kind: w.action === 'opening-shares' ? 'shares' : 'option' })}
                >
                  Add opening {w.action === 'opening-shares' ? 'shares' : 'option'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
