const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('@playwright/test');

const APP_DIR = path.join(__dirname, '..', '..');

function createLaunchContext() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'packlab3d-e2e-'));
  return { root, userData: path.join(root, 'user data'), diagnostics: path.join(root, 'main-diagnostics.log') };
}

async function launchPackLab({ backendPort = '8010', waitForReady = true } = {}) {
  const context = createLaunchContext();
  const inherited = { ...process.env };
  delete inherited.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({
      args: [APP_DIR, `--user-data-dir=${context.userData}`],
      cwd: APP_DIR,
      env: {
        ...inherited,
        NODE_ENV: 'test',
        PACKLAB_E2E: '1',
        PACKLAB_BACKEND_PORT: backendPort,
        PACKLAB_E2E_RECONSTRUCTION_DELAY_MS: process.env.PACKLAB_E2E_RECONSTRUCTION_DELAY_MS || '0',
        PACKLAB_E2E_DIAGNOSTICS_PATH: context.diagnostics,
      },
      timeout: 30000,
    });
    const window = await app.firstWindow({ timeout: 30000 });
    const waitReady = async () => window.waitForSelector('#app[data-app-ready="true"]', { timeout: 90000 });
    if (waitForReady) await waitReady();
    return {
      app,
      window,
      context,
      waitReady,
      diagnostics: () => (fs.existsSync(context.diagnostics) ? fs.readFileSync(context.diagnostics, 'utf8') : ''),
      async close() {
        await app.close();
        try { fs.rmSync(context.root, { recursive: true, force: true }); } catch (_error) { /* best effort on Windows */ }
      },
    };
  } catch (error) {
    try { fs.writeFileSync(path.join(context.root, 'launch-error.txt'), String(error.stack || error)); } catch (_writeError) { /* best effort */ }
    if (app) await app.close().catch(() => {});
    try { fs.rmSync(context.root, { recursive: true, force: true }); } catch (_error) { /* best effort */ }
    throw error;
  }
}

module.exports = { launchPackLab, createLaunchContext };
