import { useCallback, useRef, useState } from 'react';
import { useClickAway } from '../lib/useClickAway';
import type { SheetName } from '../lib/export';

interface Props {
  onExcel: () => void;
  onCsv: (sheet: SheetName) => void;
}

const SHEETS: SheetName[] = ['Positions', 'Open options', 'Cycles', 'Short trades', 'Other options', 'Transactions'];

export function ExportMenu({ onExcel, onCsv }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, open, useCallback(() => setOpen(false), []));
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className="relative" ref={ref}>
      <button className="btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        Export ▾
      </button>
      {open && (
        <>
          <div className="card absolute right-0 z-50 mt-2 w-56 py-1 text-sm shadow-2xl">
            <button className="block w-full px-3 py-2 text-left font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={pick(onExcel)}>
              Excel workbook (all tables)
            </button>
            <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
            <div className="px-3 py-1 text-xs text-zinc-500">CSV</div>
            {SHEETS.map((s) => (
              <button key={s} className="block w-full px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={pick(() => onCsv(s))}>
                {s}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
