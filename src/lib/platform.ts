// One API for both runtimes: the Electron desktop app (window.wheelDesktop from
// electron/preload.cjs) and the browser dev server (/api/* in vite.config.ts).

export interface ReportFile {
  name: string;
  size: number;
  modified: string;
}

export type UpdateStatus =
  | { state: 'idle' | 'checking' | 'none' | 'dev' }
  | { state: 'downloading'; version?: string; percent?: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string };

interface DesktopApi {
  platform: string;
  listReports(folder: string): Promise<ReportFile[]>;
  listFolders(): Promise<{ name: string; files: string[] }[]>;
  readReport(folder: string, name: string): Promise<string>;
  openReportsFolder(folder: string): Promise<string>;
  reportsDir(folder: string): Promise<string>;
  onReportsChanged(cb: () => void): () => void;
  fetchChart(symbol: string): Promise<unknown>;
  fetchOptionChain(symbol: string, expiry: string): Promise<unknown>;
  version(): Promise<string>;
  checkForUpdates(): Promise<{ state: string }>;
  installUpdate(): Promise<void>;
  onUpdateStatus(cb: (s: UpdateStatus) => void): () => void;
}

declare global {
  interface Window {
    wheelDesktop?: DesktopApi;
  }
}

const desktop = () => window.wheelDesktop;

export const isDesktop = () => !!desktop();

/** 'win32', 'darwin', … in the desktop app; null in the browser. */
export const desktopPlatform = (): string | null => desktop()?.platform ?? null;

async function getJson(url: string): Promise<any> {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body;
}

export async function listReports(folder: string): Promise<ReportFile[]> {
  const d = desktop();
  if (d) return d.listReports(folder);
  return getJson(`/api/reports?folder=${encodeURIComponent(folder)}`);
}

/** Sub-folders of the reports folder and their CSVs (each sub-folder is an account). */
export async function listFolders(): Promise<{ name: string; files: string[] }[]> {
  const d = desktop();
  if (d) return d.listFolders();
  return getJson('/api/folders');
}

export async function readReport(folder: string, name: string): Promise<string> {
  const d = desktop();
  if (d) return d.readReport(folder, name);
  const res = await fetch(`/api/reports/${encodeURIComponent(name)}?folder=${encodeURIComponent(folder)}`);
  if (!res.ok) throw new Error(`Could not load ${name}`);
  return res.text();
}

export function openReportsFolder(folder: string): void {
  desktop()?.openReportsFolder(folder);
}

export async function reportsDir(folder: string): Promise<string> {
  const d = desktop();
  if (d) return d.reportsDir(folder);
  return folder ? `reports/${folder}/` : 'reports/';
}

/** Calls `cb` when a CSV is added/changed in the reports folder. Returns an unsubscribe function. */
export function onReportsChanged(cb: () => void): () => void {
  const d = desktop();
  if (d) return d.onReportsChanged(cb);
  if (import.meta.hot) {
    import.meta.hot.on('wt:reports-changed', cb);
    return () => import.meta.hot?.off('wt:reports-changed', cb);
  }
  return () => {};
}

/** Raw Yahoo v8 chart JSON for one symbol. */
export async function fetchYahooChart(symbol: string): Promise<any> {
  const d = desktop();
  if (d) return d.fetchChart(symbol);
  return getJson(`/api/chart?symbol=${encodeURIComponent(symbol)}`);
}

/** Yahoo option chain (optionChain.result[0]) for one symbol and expiry. */
export async function fetchYahooOptionChain(symbol: string, expiry: string): Promise<any> {
  const d = desktop();
  if (d) return d.fetchOptionChain(symbol, expiry);
  return getJson(`/api/options?symbol=${encodeURIComponent(symbol)}&expiry=${expiry}`);
}

export async function appVersion(): Promise<string | null> {
  return desktop()?.version() ?? null;
}

export function checkForUpdates(): void {
  desktop()?.checkForUpdates();
}

export function installUpdate(): void {
  desktop()?.installUpdate();
}

export function onUpdateStatus(cb: (s: UpdateStatus) => void): () => void {
  return desktop()?.onUpdateStatus(cb) ?? (() => {});
}
