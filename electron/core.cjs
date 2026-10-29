// Shared by electron/main.cjs (desktop app) and vite.config.ts (browser dev server):
// reading the reports folder and talking to Yahoo Finance. Node only, no Electron APIs.
const fs = require('node:fs');
const path = require('node:path');

const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
};

// ---------- Reports folder ----------

/** Account sub-folder name → safe single path segment ('' = the root reports folder). */
function safeFolder(folder) {
  return path.basename(String(folder || '')).replace(/[<>:"|?*]/g, '').trim();
}

function folderPath(baseDir, folder) {
  const dir = path.join(baseDir, safeFolder(folder));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function listReports(baseDir, folder) {
  const dir = folderPath(baseDir, folder);
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.csv'))
    .map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      return { name, size: stat.size, modified: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

/** Sub-folders of the reports folder with their CSVs: each one is an account. */
function listFolders(baseDir) {
  fs.mkdirSync(baseDir, { recursive: true });
  return fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => ({ name: d.name, files: listReports(baseDir, d.name).map((f) => f.name) }));
}

function readReport(baseDir, folder, name) {
  const safe = path.basename(String(name));
  if (!safe.toLowerCase().endsWith('.csv')) throw new Error('Not a CSV file');
  return fs.readFileSync(path.join(folderPath(baseDir, folder), safe), 'utf8');
}

/** Calls `onChange()` (debounced) when CSVs are added or changed anywhere under baseDir. */
function watchReports(baseDir, onChange) {
  fs.mkdirSync(baseDir, { recursive: true });
  let timer = null;
  try {
    return fs.watch(baseDir, { recursive: true }, (_event, file) => {
      if (file && !String(file).toLowerCase().endsWith('.csv')) return;
      clearTimeout(timer);
      timer = setTimeout(onChange, 1000);
    });
  } catch {
    return null;
  }
}

// ---------- Yahoo Finance ----------

async function fetchChart(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(String(symbol))}?range=1d&interval=1d`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`Yahoo ${res.status} for ${symbol}`);
  return res.json();
}

// The options endpoint needs a session cookie plus a matching "crumb" token.
let session = null; // { cookie, crumb, at }

async function getSession(force) {
  if (!force && session && Date.now() - session.at < 30 * 60_000) return session;
  const first = await fetch('https://fc.yahoo.com', { headers: UA, redirect: 'manual' });
  const cookie = first.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  if (!cookie) throw new Error('Yahoo did not return a session cookie');
  const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { ...UA, Cookie: cookie } });
  const crumb = (await crumbRes.text()).trim();
  if (!crumbRes.ok || !crumb || crumb.includes('<')) throw new Error('Could not get a Yahoo crumb');
  session = { cookie, crumb, at: Date.now() };
  return session;
}

/** Option chain for one symbol and expiry (ISO date). Returns Yahoo's optionChain.result[0]. */
async function fetchOptionChain(symbol, expiryIso) {
  const date = Math.floor(Date.parse(`${expiryIso}T00:00:00Z`) / 1000);
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await getSession(attempt > 0);
    const url = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(String(symbol))}?date=${date}&crumb=${encodeURIComponent(s.crumb)}`;
    const res = await fetch(url, { headers: { ...UA, Cookie: s.cookie } });
    if (res.status === 401 || res.status === 403) continue;
    if (!res.ok) throw new Error(`Yahoo options ${res.status} for ${symbol}`);
    const json = await res.json();
    const result = json && json.optionChain && json.optionChain.result && json.optionChain.result[0];
    if (!result) throw new Error(`No option chain for ${symbol}`);
    return result;
  }
  throw new Error('Yahoo rejected the options request');
}

module.exports = { safeFolder, folderPath, listReports, listFolders, readReport, watchReports, fetchChart, fetchOptionChain };
