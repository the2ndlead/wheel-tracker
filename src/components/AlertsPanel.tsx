import { useState } from 'react';
import type { Alert, AlertSeverity } from '../engine/alerts';

const STYLE: Record<AlertSeverity, { icon: string; label: string; cls: string }> = {
  critical: { icon: '⛔', label: 'Critical', cls: 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200' },
  warning: { icon: '⚠', label: 'Warning', cls: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200' },
  info: { icon: 'ℹ', label: 'Info', cls: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200' },
};

interface Props {
  alerts: Alert[];
  onOpenOption: (key: string) => void;
}

export function AlertsPanel({ alerts, onOpenOption }: Props) {
  const [showAll, setShowAll] = useState(false);
  if (!alerts.length) return null;
  const visible = showAll ? alerts : alerts.slice(0, 4);
  return (
    <section aria-label="Alerts" className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Alerts ({alerts.length})</h2>
        {alerts.length > 4 && (
          <button className="text-sm text-sky-600 hover:underline dark:text-sky-400" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Show fewer' : `Show all ${alerts.length}`}
          </button>
        )}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {visible.map((a) => {
          const s = STYLE[a.severity];
          return (
            <div key={a.id} className={`flex items-start gap-3 rounded-lg border px-3 py-2 text-sm ${s.cls}`}>
              <span aria-hidden className="text-base leading-5">
                {s.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  <span className="sr-only">{s.label}: </span>
                  {a.ticker && <span className="mr-1 font-semibold">{a.ticker}</span>}
                  {a.title}
                </div>
                <div className="text-xs opacity-80">{a.detail}</div>
              </div>
              {a.optionKey && (
                <button className="shrink-0 text-xs font-medium underline" onClick={() => onOpenOption(a.optionKey!)}>
                  Analyze
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
