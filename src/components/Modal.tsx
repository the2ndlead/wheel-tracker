import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}

export function Modal({ title, onClose, children, footer, width = 'max-w-3xl' }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Portal to <body>: a modal opened from inside the sticky header would otherwise be clipped
  // to the header's box (its backdrop-blur makes it the containing block for fixed elements).
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className={`card my-8 w-full ${width} shadow-2xl`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-4 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export const inputClass =
  'w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm tabular-nums dark:border-zinc-700 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-sky-500';

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>}
    </label>
  );
}
