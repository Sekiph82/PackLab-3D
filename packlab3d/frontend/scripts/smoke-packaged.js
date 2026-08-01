const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { chromium } = require('playwright');

const frontendRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(frontendRoot, '..', '..');
const releaseRoot = path.join(projectRoot, 'release');
const exePath = path.join(releaseRoot, 'PackLab3D.exe');
const remotePort = Number(process.env.PACKLAB_REMOTE_DEBUGGING_PORT || 9331);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await sleep(1200);
  if (child.exitCode === null && process.platform === 'win32') {
    await new Promise((resolve) => {
      execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => resolve());
    });
  }
}

async function waitForCdp() {
  const started = Date.now();
  while (Date.now() - started < 45000) {
    try {
      const response = await fetch(`http://127.0.0.1:${remotePort}/json/version`);
      if (response.ok) return true;
    } catch (err) {
      // keep polling
    }
    await sleep(500);
  }
  return false;
}

(async () => {
  if (!fs.existsSync(exePath)) throw new Error(`Packaged executable missing: ${exePath}`);

  const child = spawn(exePath, [`--remote-debugging-port=${remotePort}`], {
    cwd: releaseRoot,
    windowsHide: true,
    env: { ...process.env, PACKLAB_STARTUP_TIMEOUT_MS: '45000' },
  });

  const errors = [];
  try {
    if (!(await waitForCdp())) throw new Error('Timed out waiting for packaged app remote debugging port');
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${remotePort}`);
    const page = browser.contexts()[0]?.pages()[0] || (await browser.contexts()[0].newPage());
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('requestfailed', (request) => {
      errors.push(`${request.failure()?.errorText || 'request failed'} ${request.url()}`);
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await page.waitForSelector('#threejs-viewer canvas', { timeout: 45000 });
    await page.waitForFunction(() => !document.body.textContent.includes('ERR_FILE_NOT_FOUND'), null, { timeout: 5000 });
    const diagnostics = await page.evaluate(() => window.packlab.diagnostics.get());
    const canvasCount = await page.locator('#threejs-viewer canvas').count();
    if (canvasCount < 1) throw new Error('Three.js canvas was not created');
    if (!diagnostics.backendUrl) throw new Error('Backend URL missing from diagnostics');

    const health = await fetch(`${diagnostics.backendUrl}/health/live`).then((res) => res.json());
    if (health.status !== 'alive') throw new Error(`Unexpected backend health response: ${JSON.stringify(health)}`);

    if (errors.some((item) => item.includes('ERR_FILE_NOT_FOUND') || item.includes('GLTFLoader') || item.includes('OrbitControls'))) {
      throw new Error(`Renderer console errors: ${errors.join('\n')}`);
    }
    console.log(JSON.stringify({ ok: true, backendUrl: diagnostics.backendUrl, startupEvents: diagnostics.startupEvents }, null, 2));
    await page.close();
    await sleep(2000);
    await browser.close();
  } finally {
    await stopProcess(child);
    await sleep(1000);
    const lingering = await new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-Command', "Get-Process PackLab3DBackend -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"], { windowsHide: true }, (_err, stdout) => resolve(stdout.trim()));
    });
    if (lingering) throw new Error(`Backend process still running after app close: ${lingering}`);
  }
})().catch((err) => {
  console.error(`[smoke-packaged] ERROR: ${err.stack || err.message}`);
  process.exit(1);
});
