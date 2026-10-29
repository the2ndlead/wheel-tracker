import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Same reports/Yahoo logic the desktop app uses (electron/main.cjs). Loaded with require at
// runtime because Vite bundles this config as ESM, which can't inline a CommonJS module.
const core: typeof import('./electron/core.cjs') = createRequire(import.meta.url)(path.resolve(__dirname, 'electron/core.cjs'));

const REPORTS_DIR = path.resolve(__dirname, 'reports');

// Dev/preview server endpoints, mirroring the desktop app's IPC:
//   GET /api/folders                           -> [{ name, files }] sub-folders (one per account)
//   GET /api/reports?folder=<account>          -> [{ name, size, modified }] newest first
//   GET /api/reports/<name>?folder=<account>   -> raw CSV text
//   GET /api/chart?symbol=AAPL                 -> Yahoo chart JSON (quotes)
//   GET /api/options?symbol=AAPL&expiry=ISO    -> Yahoo option chain (cookie + crumb handled server-side)
function localApi(): Plugin {
  const json = (res: ServerResponse, body: unknown, status = 200) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };

  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const q = url.searchParams;
    try {
      if (url.pathname === '/folders') return json(res, core.listFolders(REPORTS_DIR));
      if (url.pathname === '/reports' || url.pathname === '/reports/') {
        return json(res, core.listReports(REPORTS_DIR, q.get('folder')));
      }
      if (url.pathname.startsWith('/reports/')) {
        const name = decodeURIComponent(url.pathname.slice('/reports/'.length));
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        return res.end(core.readReport(REPORTS_DIR, q.get('folder'), name));
      }
      if (url.pathname === '/chart') return json(res, await core.fetchChart(q.get('symbol')));
      if (url.pathname === '/options') return json(res, await core.fetchOptionChain(q.get('symbol'), q.get('expiry')));
      return next();
    } catch (e) {
      return json(res, { error: e instanceof Error ? e.message : String(e) }, 502);
    }
  };

  return {
    name: 'wheel-tracker-api',
    configureServer(server) {
      server.middlewares.use('/api', handler);
      // Tell the page when a CSV lands in reports/ so it can auto-load it.
      // (Not under Vitest: an open watcher keeps the test process alive.)
      if (!process.env.VITEST) core.watchReports(REPORTS_DIR, () => server.ws.send({ type: 'custom', event: 'wt:reports-changed' }));
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api', handler);
    },
  };
}

export default defineConfig({
  // Relative asset paths so the built page also loads from disk inside the Electron app.
  base: './',
  plugins: [react(), localApi()],
  test: { environment: 'node' },
});
