import { describe, expect, it } from 'vitest';
import { newAccount, type Account } from './accounts';
import { syncAccountsWithFolders } from './folderSync';

const acct = (id: string, name: string, folder: string): Account => ({ ...newAccount(name, folder), id });
const roth = { name: 'Roth IRA', files: ['wheel-report.csv'] };
const ind = { name: 'Individual', files: ['individual.csv'] };

describe('syncAccountsWithFolders', () => {
  it('creates an account per sub-folder and replaces the empty main-folder account', () => {
    // v0.1/v0.2 install: "Default" imported the Roth file from the main folder, which has since moved.
    const r = syncAccountsWithFolders([acct('default', 'Default', '')], [roth, ind], [], { default: ['wheel-report.csv'] });
    expect(r.accounts.map((a) => [a.name, a.folder])).toEqual([
      ['Roth IRA', 'Roth IRA'],
      ['Individual', 'Individual'],
    ]);
    expect(r.removed).toEqual(['default']);
    expect(Object.values(r.load)).toEqual([['wheel-report.csv'], ['individual.csv']]);
  });

  it('reuses an account already named after the folder', () => {
    const r = syncAccountsWithFolders([acct('a', 'Roth IRA', ''), acct('b', 'Individual', 'Individual')], [roth, ind], [], {
      a: ['wheel-report.csv'],
      b: ['individual.csv'],
    });
    expect(r.created).toEqual([]);
    expect(r.removed).toEqual([]);
    expect(r.accounts.find((a) => a.id === 'a')!.folder).toBe('Roth IRA');
    expect(r.load).toEqual({});
  });

  it("drops a file that belongs to another account's folder", () => {
    // The Roth report had been loaded into Individual too.
    const r = syncAccountsWithFolders([acct('a', 'Roth IRA', 'Roth IRA'), acct('b', 'Individual', 'Individual')], [roth, ind], [], {
      a: ['wheel-report.csv'],
      b: ['individual.csv', 'wheel-report.csv'],
    });
    expect(r.drop).toEqual({ b: ['wheel-report.csv'] });
    expect(r.load).toEqual({});
  });

  it('keeps the main-folder account while it still has files or its own imports', () => {
    const withFiles = syncAccountsWithFolders([acct('d', 'Default', '')], [ind], ['other.csv'], { d: ['other.csv'] });
    expect(withFiles.removed).toEqual([]);
    const dropped = syncAccountsWithFolders([acct('d', 'Default', '')], [ind], [], { d: ['dragged-in.csv'] });
    expect(dropped.removed).toEqual([]);
  });

  it('keeps the main-folder account when it holds manually entered trades', () => {
    const r = syncAccountsWithFolders([acct('d', 'Default', '')], [roth, ind], [], {}, ['d']);
    expect(r.removed).toEqual([]);
    expect(r.accounts.map((a) => a.name)).toEqual(['Default', 'Roth IRA', 'Individual']);
  });

  it('ignores empty folders and changes nothing when already in sync', () => {
    const accounts = [acct('a', 'Roth IRA', 'Roth IRA'), acct('b', 'Individual', 'Individual')];
    const r = syncAccountsWithFolders(accounts, [roth, ind, { name: 'Empty', files: [] }], [], { a: ['wheel-report.csv'], b: ['individual.csv'] });
    expect(r.accounts).toEqual(accounts);
    expect(r.created).toEqual([]);
    expect(r.load).toEqual({});
    expect(r.drop).toEqual({});
  });
});
