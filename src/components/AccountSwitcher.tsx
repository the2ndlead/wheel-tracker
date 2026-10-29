import { useState } from 'react';
import { ALL_ID, folderFor, newAccount, type Account } from '../lib/accounts';
import { Modal, inputClass } from './Modal';

interface Props {
  accounts: Account[];
  activeId: string;
  onSwitch: (id: string) => void;
  onChange: (accounts: Account[]) => void;
  onDelete: (id: string) => void;
}

export function AccountSwitcher({ accounts, activeId, onSwitch, onChange, onDelete }: Props) {
  const [managing, setManaging] = useState(false);
  const [newName, setNewName] = useState('');

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    const folder = folderFor(name);
    const a = newAccount(name, accounts.some((x) => x.folder === folder) ? `${folder}-${accounts.length}` : folder);
    onChange([...accounts, a]);
    onSwitch(a.id);
    setNewName('');
  };

  return (
    <>
      <div className="flex items-center gap-1">
        <select
          value={activeId}
          onChange={(e) => (e.target.value === '__manage' ? setManaging(true) : onSwitch(e.target.value))}
          className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm font-medium dark:border-zinc-700 dark:bg-zinc-800"
          aria-label="Account"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
          {accounts.length > 1 && <option value={ALL_ID}>All accounts (combined)</option>}
          <option value="__manage">Manage accounts…</option>
        </select>
      </div>

      {managing && (
        <Modal title="Accounts" onClose={() => setManaging(false)} width="max-w-2xl">
          <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">
            Keep accounts separate, e.g. an IRA and a brokerage account. Each has its own reports sub-folder, imports, opening balances and
            settings.
          </p>
          <ul className="mb-4 space-y-2">
            {accounts.map((a) => (
              <li key={a.id} className="flex items-center gap-2">
                <input
                  className={inputClass}
                  value={a.name}
                  onChange={(e) => onChange(accounts.map((x) => (x.id === a.id ? { ...x, name: e.target.value } : x)))}
                  aria-label="Account name"
                />
                <span className="hidden w-40 shrink-0 truncate text-xs text-zinc-500 sm:block" title="Reports sub-folder">
                  📁 {a.folder || '(main folder)'}
                </span>
                <button
                  className="btn"
                  disabled={accounts.length === 1}
                  onClick={() => window.confirm(`Delete "${a.name}" and its saved data? CSV files on disk are kept.`) && onDelete(a.id)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <input className={inputClass} placeholder="New account name, e.g. Brokerage" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
            <button className="btn-primary" onClick={add} disabled={!newName.trim()}>
              Add
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
