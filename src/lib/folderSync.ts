// Keeps accounts in step with the reports folder: every sub-folder that holds CSVs is an
// account (named after the folder), and each account shows the files in its own folder.
import { newAccount, type Account } from './accounts';

export interface FolderInfo {
  name: string;
  /** CSV file names in the folder, newest first. */
  files: string[];
}

export interface SyncResult {
  accounts: Account[];
  /** Ids of accounts created from folders. */
  created: string[];
  /** Ids of accounts removed (an empty main-folder account replaced by sub-folder accounts). */
  removed: string[];
  /** Account id → CSV names to load from its folder (accounts with nothing imported yet). */
  load: Record<string, string[]>;
  /** Account id → imported file names to drop because they belong to another account's folder. */
  drop: Record<string, string[]>;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * @param imports account id → names of the CSVs currently imported into it
 * @param keep ids of accounts that must never be removed (e.g. they hold manually entered trades)
 */
export function syncAccountsWithFolders(
  accounts: Account[],
  folders: FolderInfo[],
  rootFiles: string[],
  imports: Record<string, string[] | undefined>,
  keep: string[] = [],
): SyncResult {
  const next = accounts.map((a) => ({ ...a }));
  const created: string[] = [];

  for (const f of folders.filter((f) => f.files.length)) {
    let acct = next.find((a) => a.folder && same(a.folder, f.name));
    // An account the user already named after this folder (e.g. renamed "Default" to "Roth IRA")
    // takes the folder over, as long as the main folder itself is empty.
    if (!acct && !rootFiles.length) acct = next.find((a) => !a.folder && same(a.name, f.name));
    if (acct) acct.folder = f.name;
    else {
      const a = newAccount(f.name, f.name);
      next.push(a);
      created.push(a.id);
    }
  }

  const filesOf = (a: Account) => (a.folder ? folders.find((f) => same(f.name, a.folder))?.files ?? [] : rootFiles);
  const inOtherFolder = (a: Account, name: string) => next.some((b) => b.id !== a.id && filesOf(b).includes(name));

  // The main-folder account is redundant once its files live in sub-folders.
  const removed = next
    .filter((a) => !a.folder && !rootFiles.length && next.length > 1 && !keep.includes(a.id))
    .filter((a) => (imports[a.id] ?? []).every((n) => inOtherFolder(a, n)))
    .map((a) => a.id);
  const kept = next.filter((a) => !removed.includes(a.id));

  const load: Record<string, string[]> = {};
  const drop: Record<string, string[]> = {};
  for (const a of kept) {
    const imported = imports[a.id] ?? [];
    const files = filesOf(a);
    const misplaced = imported.filter((n) => !files.includes(n) && inOtherFolder(a, n));
    if (misplaced.length) drop[a.id] = misplaced;
    if (imported.length === misplaced.length && files.length) load[a.id] = files;
  }

  return { accounts: kept, created, removed, load, drop };
}
