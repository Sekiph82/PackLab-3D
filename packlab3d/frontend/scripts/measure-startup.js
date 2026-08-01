const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { chromium } = require('playwright');

const frontendRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(frontendRoot, '..', '..');
const releaseRoot = path.join(projectRoot, 'release');
const claudeLogDir = path.join(projectRoot, 'logs', 'claude');
const shortcutPath = path.join(process.env.USERPROFILE || '', 'Desktop', 'PackLab 3D.lnk');
const basePort = Number(process.env.PACKLAB_REMOTE_DEBUGGING_PORT || 9431);
const startupTimeoutMs = Number(process.env.PACKLAB_STARTUP_TIMEOUT_MS || 180000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ps(command) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

async function killPackLab() {
  await ps("Get-Process PackLab3D,PackLab3DBackend -ErrorAction SilentlyContinue | Stop-Process -Force").catch(() => {});
  await ps("taskkill.exe /IM PackLab3D.exe /T /F; taskkill.exe /IM PackLab3DBackend.exe /T /F").catch(() => {});
}

async function waitForCdp(port) {
  const started = Date.now();
  while (Date.now() - started < startupTimeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return Date.now() - started;
    } catch (_err) {
      // keep polling
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for CDP port ${port}`);
}

function copyReleaseForColdSimulation() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const target = path.join(claudeLogDir, `cold-release-copy-${stamp}`);
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(releaseRoot, target, { recursive: true });
  return target;
}

async function launch(scenario, port, root) {
  const env = {
    ...process.env,
    PACKLAB_REMOTE_DEBUGGING_PORT: String(port),
    PACKLAB_STARTUP_TIMEOUT_MS: String(startupTimeoutMs),
    PACKLAB_SPLASH_HOLD_MS: '0',
  };
  if (scenario.kind === 'shortcut') {
    await ps(`$env:PACKLAB_REMOTE_DEBUGGING_PORT='${port}'; $env:PACKLAB_STARTUP_TIMEOUT_MS='${startupTimeoutMs}'; Start-Process -FilePath '${shortcutPath.replace(/'/g, "''")}'`);
    return null;
  }
  return spawn(path.join(root, 'PackLab3D.exe'), [], { cwd: root, windowsHide: true, env });
}

function eventElapsed(events, stage) {
  const event = events.find((item) => item.stage === stage && (item.state === 'success' || item.state === 'warning' || item.state === 'error'));
  return event ? event.elapsedMs : null;
}

async function measureScenario(scenario, index) {
  await killPackLab();
  await sleep(scenario.preWaitMs || 0);
  const root = scenario.copyRelease ? copyReleaseForColdSimulation() : releaseRoot;
  const invokedAt = Date.now();
  const child = await launch(scenario, basePort + index, root);
  const cdpMs = await waitForCdp(basePort + index);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${basePort + index}`, { timeout: startupTimeoutMs });
  const page = browser.contexts()[0]?.pages()[0] || (await browser.contexts()[0].newPage());
  await page.waitForSelector('#threejs-viewer canvas', { timeout: startupTimeoutMs });
  const diagnostics = await page.evaluate(() => window.packlab.diagnostics.get());
  const events = diagnostics.startupEvents || [];
  await page.evaluate(() => window.packlab?.app?.quit?.());
  await browser.close().catch(() => {});
  if (child) {
    const started = Date.now();
    while (child.exitCode === null && Date.now() - started < 12000) await sleep(250);
  }
  await sleep(1200);
  await killPackLab();
  return {
    scenario: scenario.name,
    root,
    cdpMs,
    shortcutInvokedAt: scenario.kind === 'shortcut' ? new Date(invokedAt).toISOString() : null,
    windowVisibleMs: eventElapsed(events, 'Main window creation'),
    rendererDomReadyMs: eventElapsed(events, 'Renderer DOM ready'),
    spawnStartedMs: eventElapsed(events, 'Backend process spawn call started'),
    spawnReturnedMs: eventElapsed(events, 'Backend process spawn call returned'),
    spawnCallDurationMs: events.find((item) => item.stage === 'Backend process spawn call returned')?.spawnCallDurationMs ?? null,
    firstBackendOutputMs: eventElapsed(events, 'First backend output'),
    healthLiveMs: eventElapsed(events, 'Health live available'),
    capabilitiesMs: eventElapsed(events, 'Capabilities loaded'),
    appReadyMs: eventElapsed(events, 'Application ready'),
    totalMs: eventElapsed(events, 'Application ready'),
    events,
  };
}

(async () => {
  fs.mkdirSync(claudeLogDir, { recursive: true });
  const scenarios = [
    { name: 'Warm start', kind: 'direct', preWaitMs: 1000 },
    { name: 'Fresh shortcut start', kind: 'shortcut', preWaitMs: 5000 },
    { name: 'Cold simulation copied release', kind: 'direct', copyRelease: true, preWaitMs: 5000 },
  ];
  const results = [];
  for (let i = 0; i < scenarios.length; i += 1) {
    results.push(await measureScenario(scenarios[i], i));
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const outputPath = path.join(claudeLogDir, `cold-start-${stamp}.json`);
  fs.writeFileSync(outputPath, JSON.stringify({ results }, null, 2));
  console.log(JSON.stringify({ ok: true, outputPath, results }, null, 2));
})().catch((err) => {
  killPackLab().catch(() => {});
  console.error(`[measure-startup] ERROR: ${err.stack || err.message}`);
  process.exit(1);
});
