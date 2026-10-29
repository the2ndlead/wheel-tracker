// Accounts (profiles): e.g. "IRA" and "Brokerage", each with its own reports folder,
// imported files, opening balances and settings. Persisted in localStorage.
import { DEFAULT_BASIS, EMPTY_OPENING, type BasisOptions, type OpeningBalances } from '../engine/types';
import type { CsvFile } from '../parser/merge';
import { load, save } from './storage';

export interface Account {
  id: string;
  name: string;
  /** Sub-folder of the reports folder ('' = the reports folder itself). */
  folder: string;
  opening: OpeningBalances;
  basis: BasisOptions;
  monthlyGoal: number;
  /** Alert when a position is down this much vs true basis (0.15 = 15%). */
  dropThreshold: number;
  /** Load new CSVs from the reports folder automatically. */
  autoLoad: boolean;
}

export interface StoredImport {
  files: CsvFile[];
  loadedAt: string;
}

const ACCOUNTS_KEY = 'wt.accounts';
const ACTIVE_KEY = 'wt.activeAccount';
const ALL_SETTINGS_KEY = 'wt.all.settings';

/** Id of the virtual "All accounts (combined)" view. */
export const ALL_ID = '__all';

export const importKey = (id: string) => `wt.${id}.import`;
export const pricesKey = (id: string) => `wt.${id}.prices`;
export const marksKey = (id: string) => `wt.${id}.marks`;
/** Trades entered by hand (ManualTrade[]). */
export const manualKey = (id: string) => `wt.${id}.manual`;

export function newAccount(name: string, folder: string): Account {
  return {
    id: Math.random().toString(36).slice(2, 10),
    name,
    folder,
    opening: EMPTY_OPENING,
    basis: DEFAULT_BASIS,
    monthlyGoal: 0,
    dropThreshold: 0.15,
    autoLoad: true,
  };
}

/** Folder name for an account: letters, digits, spaces, dashes. */
export const folderFor = (name: string) => name.replace(/[^\w\- ]+/g, '').trim() || 'Account';

/** Loads accounts, creating "Default" and migrating v0.1 data (wt.csv / wt.prices) on first run. */
export function loadAccounts(): { accounts: Account[]; activeId: string } {
  let accounts = load<Account[]>(ACCOUNTS_KEY, []).map((a) => {
    const merged = { ...newAccount(a.name, a.folder), ...a };
    merged.basis = { ...DEFAULT_BASIS, ...a.basis };
    // v0.2.0 stored 0 for "not set"; untouched opening balances now mean "estimate cash".
    const o = merged.opening;
    if (o && o.cash === 0 && !o.asOf && !o.positions.length && !o.options.length) merged.opening = { ...o, cash: null };
    return merged;
  });
  if (!accounts.length) {
    const def = { ...newAccount('Default', ''), id: 'default' };
    accounts = [def];
    const legacy = load<{ name: string; text: string; loadedAt: string } | null>('wt.csv', null);
    if (legacy) save(importKey(def.id), { files: [{ name: legacy.name, text: legacy.text }], loadedAt: legacy.loadedAt } satisfies StoredImport);
    const legacyPrices = load<Record<string, number> | null>('wt.prices', null);
    if (legacyPrices) save(pricesKey(def.id), legacyPrices);
    save(ACCOUNTS_KEY, accounts);
  }
  const stored = load<string>(ACTIVE_KEY, accounts[0].id);
  const valid = accounts.some((a) => a.id === stored) || (stored === ALL_ID && accounts.length > 1);
  return { accounts, activeId: valid ? stored : accounts[0].id };
}

export function saveAccounts(accounts: Account[], activeId: string) {
  save(ACCOUNTS_KEY, accounts);
  save(ACTIVE_KEY, activeId);
}

/** Settings for the combined view (basis method, goal, alerts); it has no files or opening balances of its own. */
export function loadAllAccount(): Account {
  const stored = load<Partial<Account>>(ALL_SETTINGS_KEY, {});
  return {
    ...newAccount('All accounts', ''),
    ...stored,
    id: ALL_ID,
    name: 'All accounts',
    basis: { ...DEFAULT_BASIS, ...stored.basis },
    opening: EMPTY_OPENING,
    autoLoad: false,
  };
}

export function saveAllAccount(a: Account) {
  save(ALL_SETTINGS_KEY, { basis: a.basis, monthlyGoal: a.monthlyGoal, dropThreshold: a.dropThreshold });
}

export function deleteAccountData(id: string) {
  for (const key of [importKey(id), pricesKey(id), marksKey(id), manualKey(id)]) save(key, undefined);
}
