// Types for core.cjs so vite.config.ts can import it.
import type { FSWatcher } from 'node:fs';

interface ReportFile {
  name: string;
  size: number;
  modified: string;
}

declare const core: {
  safeFolder(folder: string | null): string;
  folderPath(baseDir: string, folder: string | null): string;
  listReports(baseDir: string, folder: string | null): ReportFile[];
  listFolders(baseDir: string): { name: string; files: string[] }[];
  readReport(baseDir: string, folder: string | null, name: string): string;
  watchReports(baseDir: string, onChange: () => void): FSWatcher | null;
  fetchChart(symbol: string | null): Promise<unknown>;
  fetchOptionChain(symbol: string | null, expiryIso: string | null): Promise<unknown>;
};

export = core;
