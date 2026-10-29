import { useEffect, useState } from 'react';
import { ALL_ID, type Account } from '../lib/accounts';
import { appVersion, checkForUpdates, desktopPlatform, installUpdate, isDesktop, type UpdateStatus } from '../lib/platform';
import { Field, Modal, inputClass } from './Modal';

interface Props {
  account: Account;
  update: UpdateStatus;
  onChange: (patch: Partial<Account>) => void;
  onClose: () => void;
}

export function SettingsDialog({ account, update, onChange, onClose }: Props) {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    appVersion().then(setVersion);
  }, []);
  const b = account.basis;

  return (
    <Modal title={`Settings: ${account.name}`} onClose={onClose} width="max-w-xl">
      <div className="space-y-6">
        <section>
          <h3 className="mb-2 text-sm font-semibold">True cost basis</h3>
          <div className="space-y-2 text-sm">
            <label className="flex items-start gap-2">
              <input type="radio" className="mt-1 accent-sky-600" checked={b.scope === 'all'} onChange={() => onChange({ basis: { ...b, scope: 'all' } })} />
              <span>
                <b>All premium on the ticker</b>: every short put/call premium ever collected, including earlier wheel cycles.
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" className="mt-1 accent-sky-600" checked={b.scope === 'currentCycle'} onChange={() => onChange({ basis: { ...b, scope: 'currentCycle' } })} />
              <span>
                <b>Current cycle only</b>: premium since the current wheel cycle began. Earlier cycles count as realized profit.
              </span>
            </label>
            <label className="flex items-center gap-2 pt-2">
              <input type="checkbox" className="accent-sky-600" checked={b.includeDividends} onChange={(e) => onChange({ basis: { ...b, includeDividends: e.target.checked } })} />
              Subtract dividends too
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="accent-sky-600" checked={b.includeLongOptions} onChange={(e) => onChange({ basis: { ...b, includeLongOptions: e.target.checked } })} />
              Include realized long-option P/L on the same ticker
            </label>
            <label className="flex items-start gap-2 pt-2">
              <input
                type="checkbox"
                className="mt-1 accent-sky-600"
                checked={b.realizedOnly}
                onChange={(e) => onChange({ basis: { ...b, realizedOnly: e.target.checked } })}
              />
              <span>
                <b>Realized only</b>: premium from puts and calls that are still open doesn't lower the basis until they expire, are assigned, or are
                bought back. Turn off to count premium as soon as it's received.
              </span>
            </label>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <Field label="Monthly premium goal ($)" hint="Shown on the Analytics tab. 0 = off.">
            <input type="number" className={inputClass} value={account.monthlyGoal || ''} onChange={(e) => onChange({ monthlyGoal: Number(e.target.value) || 0 })} />
          </Field>
          <Field label="Alert when down vs true basis (%)">
            <input
              type="number"
              className={inputClass}
              value={Math.round(account.dropThreshold * 100)}
              onChange={(e) => onChange({ dropThreshold: Math.max(1, Number(e.target.value) || 15) / 100 })}
            />
          </Field>
        </section>

        {account.id !== ALL_ID && (
          <section>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-sky-600" checked={account.autoLoad} onChange={(e) => onChange({ autoLoad: e.target.checked })} />
              Automatically load new CSVs saved to this account's reports folder
            </label>
          </section>
        )}

        {isDesktop() && (
          <section className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* min-w-0 + wrapping so a long status message stays inside the box */}
              <div className="min-w-0 flex-1">
                <div className="font-medium">Wheel Tracker {version}</div>
                <div className="line-clamp-3 break-words text-xs text-zinc-500 [overflow-wrap:anywhere] dark:text-zinc-400">
                  {desktopPlatform() === 'darwin' ? 'To update on Mac: git pull, then npm run dist:mac (see README).' : <UpdateText status={update} />}
                </div>
              </div>
              {desktopPlatform() === 'darwin' ? null : update.state === 'ready' ? (
                <button className="btn-primary shrink-0" onClick={installUpdate}>
                  Restart &amp; update
                </button>
              ) : (
                <button className="btn shrink-0" onClick={checkForUpdates} disabled={update.state === 'checking' || update.state === 'downloading'}>
                  Check for updates
                </button>
              )}
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}

export function UpdateText({ status }: { status: UpdateStatus }) {
  switch (status.state) {
    case 'checking':
      return <>Checking for updates…</>;
    case 'none':
      return <>You're on the latest version.</>;
    case 'downloading':
      return <>Downloading update{status.version ? ` ${status.version}` : ''}… {status.percent ?? 0}%</>;
    case 'ready':
      return <>Version {status.version} is ready to install.</>;
    case 'error':
      return <>Update check failed: {status.message}</>;
    case 'dev':
      return <>Updates are only available in the installed app.</>;
    default:
      return <>Updates are checked automatically.</>;
  }
}
