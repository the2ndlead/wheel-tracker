// Electron main process: hosts the built React app and provides what the Vite dev
// server normally does (reports folder, Yahoo data), plus folder watching and auto-update.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const core = require('./core.cjs');

// Packaged: Documents\Wheel Tracker\reports. Unpackaged (npm run app): the repo's reports/.
const reportsDir = app.isPackaged
  ? path.join(app.getPath('documents'), 'Wheel Tracker', 'reports')
  : path.join(__dirname, '..', 'reports');

let win = null;

function ensureReportsDir() {
  fs.mkdirSync(reportsDir, { recursive: true });
  const readme = path.join(reportsDir, 'README.txt');
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(
      readme,
      [
        'Put your Robinhood account activity CSV exports in this folder.',
        'Make one sub-folder per account (e.g. "Roth IRA", "Individual"): each becomes an account in the app.',
        '',
        'Robinhood: Account > Reports and statements > Reports > generate an account activity report',
        'covering your entire account history, then save the CSV here.',
        '',
        'Wheel Tracker lists the newest file first. Your files never leave this computer.',
      ].join('\r\n'),
    );
  }
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Wheel Tracker',
    backgroundColor: '#09090b',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build-resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Dropping a file outside the drop zone would otherwise navigate away from the app.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

function setupAutoUpdate() {
  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged || process.platform !== 'win32') return { state: 'dev' };
    await autoUpdater().checkForUpdates();
    return { state: 'checking' };
  });
  ipcMain.handle('update:install', () => autoUpdater().quitAndInstall());
  // electron-updater needs a Developer ID-signed app on macOS; the Mac build is ad-hoc signed,
  // so Mac users update by pulling and rebuilding (README → Mac).
  if (!app.isPackaged || process.platform !== 'win32') return;

  const u = autoUpdater();
  u.autoDownload = true;
  u.on('checking-for-update', () => send('update:status', { state: 'checking' }));
  u.on('update-not-available', () => send('update:status', { state: 'none' }));
  u.on('update-available', (info) => send('update:status', { state: 'downloading', version: info.version, percent: 0 }));
  u.on('download-progress', (p) => send('update:status', { state: 'downloading', percent: Math.round(p.percent) }));
  u.on('update-downloaded', (info) => send('update:status', { state: 'ready', version: info.version }));
  u.on('error', (err) => {
    const message = friendlyUpdateError(err);
    // Nothing published yet isn't a failure: this is the latest version.
    send('update:status', message === NOTHING_PUBLISHED ? { state: 'none' } : { state: 'error', message });
  });

  const check = () => u.checkForUpdates().catch(() => {});
  setTimeout(check, 5_000);
  setInterval(check, 6 * 60 * 60_000);
}

// electron-updater errors include full HTTP headers and URLs; keep just what a person needs.
const NOTHING_PUBLISHED = 'No updates have been published yet.';
function friendlyUpdateError(err) {
  const text = String((err && err.message) || err || '');
  if (/\b404\b|Unable to find latest version|No published versions/i.test(text)) return NOTHING_PUBLISHED;
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|net::ERR_/i.test(text)) return "Couldn't reach GitHub. Check your internet connection.";
  if (/\b(401|403)\b|rate limit/i.test(text)) return 'GitHub refused the update check. Try again later.';
  const first = text.split('\n')[0].trim();
  return first.length > 140 ? `${first.slice(0, 140)}…` : first || 'Unknown error';
}

// Loaded lazily so `npm run app` works even before electron-updater is installed.
let updater = null;
function autoUpdater() {
  if (!updater) updater = require('electron-updater').autoUpdater;
  return updater;
}

app.whenReady().then(() => {
  ensureReportsDir();
  ipcMain.handle('reports:list', (_e, folder) => core.listReports(reportsDir, folder));
  ipcMain.handle('reports:folders', () => core.listFolders(reportsDir));
  ipcMain.handle('reports:read', (_e, folder, name) => core.readReport(reportsDir, folder, name));
  ipcMain.handle('reports:open-folder', (_e, folder) => shell.openPath(core.folderPath(reportsDir, folder)));
  ipcMain.handle('reports:dir', (_e, folder) => core.folderPath(reportsDir, folder));
  ipcMain.handle('quotes:chart', (_e, symbol) => core.fetchChart(symbol));
  ipcMain.handle('quotes:options', (_e, symbol, expiry) => core.fetchOptionChain(symbol, expiry));
  ipcMain.handle('app:version', () => app.getVersion());
  setupAutoUpdate();
  createWindow();
  core.watchReports(reportsDir, () => send('reports:changed'));
});

app.on('window-all-closed', () => app.quit());
