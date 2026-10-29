import { useCallback, useEffect, useRef, useState } from 'react';
import { useClickAway } from '../lib/useClickAway';
import { isDesktop, listReports, openReportsFolder, readReport, reportsDir, type ReportFile } from '../lib/platform';
import type { CsvFile } from '../parser/merge';

interface Props {
  /** Account sub-folder of reports/. */
  folder: string;
  /** Files currently imported, pre-checked in the list. */
  loaded: string[];
  onLoad: (files: CsvFile[]) => void;
  /** Bumped by the parent when the reports folder changes on disk. */
  refreshKey?: number;
  compact?: boolean;
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString();

export function ImportPanel({ folder, loaded, onLoad, refreshKey, compact }: Props) {
  const [reports, setReports] = useState<ReportFile[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dir, setDir] = useState('reports/');
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickAway(menuRef, open, useCallback(() => setOpen(false), []));

  const refresh = () =>
    listReports(folder)
      .then((files) => {
        setReports(files);
        setChecked((prev) => {
          const keep = new Set([...prev, ...loaded].filter((n) => files.some((f) => f.name === n)));
          if (!keep.size && files[0]) keep.add(files[0].name);
          return keep;
        });
      })
      .catch(() => setReports(null));

  useEffect(() => {
    refresh();
    reportsDir(folder).then(setDir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, refreshKey, loaded.join('|')]);

  const readFiles = async (list: FileList | File[]) => {
    setError(null);
    try {
      const files = await Promise.all([...list].filter((f) => f.name.toLowerCase().endsWith('.csv')).map(async (f) => ({ name: f.name, text: await f.text() })));
      if (!files.length) throw new Error('Choose one or more .csv files.');
      onLoad(files);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const loadChecked = async () => {
    setError(null);
    try {
      const names = reports!.filter((r) => checked.has(r.name)).map((r) => r.name);
      onLoad(await Promise.all(names.map(async (name) => ({ name, text: await readReport(folder, name) }))));
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggle = (name: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept=".csv,text/csv"
      multiple
      className="hidden"
      onChange={(e) => {
        if (e.target.files?.length) readFiles(e.target.files);
        e.target.value = '';
      }}
    />
  );

  const reportList = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-zinc-600 dark:text-zinc-300">
        <span>
          Reports in <code className="break-all">{dir}</code>
        </span>
        <div className="flex gap-2">
          {isDesktop() && (
            <button className="btn" onClick={() => openReportsFolder(folder)}>
              Open folder
            </button>
          )}
          <button className="btn" onClick={refresh} title="Rescan the folder">
            ↻
          </button>
        </div>
      </div>
      {reports && reports.length > 0 ? (
        <>
          <ul className="max-h-64 divide-y divide-zinc-100 overflow-auto rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {reports.map((r) => (
              <li key={r.name}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  <input type="checkbox" checked={checked.has(r.name)} onChange={() => toggle(r.name)} className="h-4 w-4 accent-sky-600" />
                  <span className="flex-1 truncate">{r.name}</span>
                  <span className="text-xs text-zinc-500">{fmtDate(r.modified)}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Tick several files to merge them. Overlapping rows are removed.</span>
            <button className="btn-primary" disabled={!checked.size} onClick={loadChecked}>
              Load {checked.size > 1 ? `${checked.size} files` : 'selected'}
            </button>
          </div>
        </>
      ) : (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No CSV files here yet. Save your Robinhood export into this folder, or choose files below.</p>
      )}
      {error && <div className="text-sm text-rose-500">{error}</div>}
    </div>
  );

  if (compact) {
    return (
      <div className="relative" ref={menuRef}>
        <button className="btn" onClick={() => setOpen(!open)} aria-expanded={open}>
          Reports ▾
        </button>
        {open && (
          <>
            <div className="card absolute right-0 z-50 mt-2 w-[min(28rem,calc(100vw-2rem))] p-4 shadow-2xl">
              {reportList}
              <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                <button className="btn w-full justify-center" onClick={() => inputRef.current?.click()}>
                  Choose CSV files from elsewhere…
                </button>
              </div>
              {fileInput}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files?.length) readFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`card flex cursor-pointer flex-col items-center justify-center gap-2 border-2 border-dashed px-6 py-14 text-center transition ${
          dragging ? 'border-sky-500 bg-sky-500/5' : ''
        }`}
      >
        <div className="text-4xl">📄</div>
        <div className="text-lg font-semibold">Drop your Robinhood activity CSV(s) here</div>
        <div className="text-sm text-zinc-500 dark:text-zinc-400">or click to choose files. They never leave your computer.</div>
        {fileInput}
      </div>

      <div className="card p-4">{reportList}</div>

      <div className="card p-4 text-sm text-zinc-600 dark:text-zinc-300">
        <div className="mb-1 font-medium text-zinc-800 dark:text-zinc-100">How to export from Robinhood</div>
        <ol className="list-decimal space-y-0.5 pl-5">
          <li>On robinhood.com go to Account → Reports and statements → Reports.</li>
          <li>
            Generate an account activity report covering your <b>entire</b> history. If you only export part of it, add your starting
            cash and positions under <b>Opening balances</b>.
          </li>
          <li>Download the CSV and drop it here, or save it into the reports folder.</li>
        </ol>
      </div>
    </div>
  );
}
