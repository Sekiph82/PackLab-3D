const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { chromium } = require('playwright');

const frontendRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(frontendRoot, '..', '..');
const releaseRoot = path.join(projectRoot, 'release');
const exePath = path.join(releaseRoot, 'PackLab3D.exe');
const shortcutPath = path.join(process.env.USERPROFILE || '', 'Desktop', 'PackLab 3D.lnk');
const claudeLogDir = path.join(projectRoot, 'logs', 'claude');
const basePort = Number(process.env.PACKLAB_REMOTE_DEBUGGING_PORT || 9331);
const scenarios = (process.env.PACKLAB_SMOKE_SCENARIOS || 'normal,degraded')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ps(command) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true }, (_err, stdout) => resolve(stdout.trim()));
  });
}

async function listPackLabProcesses() {
  const output = await ps("Get-Process PackLab3D,PackLab3DBackend -ErrorAction SilentlyContinue | Select-Object ProcessName,Id,Path | ConvertTo-Json -Compress");
  if (!output) return [];
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function killPackLabProcesses() {
  await ps("Get-Process PackLab3D,PackLab3DBackend -ErrorAction SilentlyContinue | Stop-Process -Force");
}

async function waitForCdp(port) {
  const started = Date.now();
  while (Date.now() - started < 60000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return true;
    } catch (_err) {
      // keep polling
    }
    await sleep(500);
  }
  return false;
}

function launchDirect({ port, forceBackendFail, splashHoldMs }) {
  return spawn(exePath, [], {
    cwd: releaseRoot,
    windowsHide: true,
    env: {
      ...process.env,
      PACKLAB_REMOTE_DEBUGGING_PORT: String(port),
      PACKLAB_STARTUP_TIMEOUT_MS: '45000',
      PACKLAB_SPLASH_HOLD_MS: String(splashHoldMs || 0),
      ...(forceBackendFail ? { PACKLAB_FORCE_BACKEND_FAIL: '1' } : {}),
    },
  });
}

async function launchShortcut({ port, splashHoldMs }) {
  await ps(`$env:PACKLAB_REMOTE_DEBUGGING_PORT='${port}'; $env:PACKLAB_STARTUP_TIMEOUT_MS='45000'; $env:PACKLAB_SPLASH_HOLD_MS='${splashHoldMs || 0}'; Start-Process -FilePath '${shortcutPath.replace(/'/g, "''")}'`);
  return null;
}

async function closeApp(page, browser, child) {
  try {
    await page.evaluate(() => window.packlab?.app?.quit?.());
  } catch (_err) {
    // fall through to process wait/cleanup
  }
  try {
    await browser.close();
  } catch (_err) {
    // browser may already be closing
  }
  if (child) {
    const started = Date.now();
    while (child.exitCode === null && Date.now() - started < 12000) {
      await sleep(250);
    }
  } else {
    const started = Date.now();
    while ((await listPackLabProcesses()).length && Date.now() - started < 12000) {
      await sleep(250);
    }
  }
}

function createSmokePngFiles(count) {
  fs.mkdirSync(claudeLogDir, { recursive: true });
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mP8z8BQDwAFgwJ/l5W1WQAAAABJRU5ErkJggg==',
    'base64'
  );
  return Array.from({ length: count }, (_item, index) => {
    const filePath = path.join(claudeLogDir, `multi-photo-smoke-${index + 1}.png`);
    fs.writeFileSync(filePath, png);
    return filePath;
  });
}

async function runScenario(name, index) {
  if (!fs.existsSync(exePath)) throw new Error(`Packaged executable missing: ${exePath}`);
  if (name === 'shortcut' && !fs.existsSync(shortcutPath)) throw new Error(`Shortcut missing: ${shortcutPath}`);

  await killPackLabProcesses();
  await sleep(1000);

  const port = basePort + index;
  const capturePath = process.env.PACKLAB_SPLASH_SCREENSHOT && name === 'shortcut'
    ? process.env.PACKLAB_SPLASH_SCREENSHOT
    : null;
  const child = name === 'shortcut'
    ? await launchShortcut({ port, splashHoldMs: capturePath ? 5000 : 0 })
    : launchDirect({ port, forceBackendFail: name === 'degraded', splashHoldMs: capturePath ? 5000 : 0 });

  const errors = [];
  let browser;
  let page;
  try {
    if (!(await waitForCdp(port))) throw new Error(`Timed out waiting for ${name} remote debugging port ${port}`);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    page = context.pages()[0] || (await context.newPage());
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('requestfailed', (request) => {
      errors.push(`${request.failure()?.errorText || 'request failed'} ${request.url()}`);
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await page.waitForSelector('#splash-logo[src^="data:image/png"]', { timeout: 15000 });
    await page.waitForSelector('#loading-text', { timeout: 15000 });
    if (capturePath) {
      await page.screenshot({ path: capturePath, fullPage: false });
    }

    if (name === 'degraded') {
      await page.waitForSelector('#startup-failure-actions:not([hidden]) #retry-backend-button', { timeout: 20000 });
      await page.waitForSelector('#threejs-viewer canvas', { timeout: 20000 });
      const stageText = await page.locator('#startup-stages').textContent();
      if (!stageText.includes('Startup failed')) throw new Error(`Expected degraded startup stage, got: ${stageText}`);
    } else {
      await page.waitForSelector('#threejs-viewer canvas', { timeout: 60000 });
      const diagnostics = await page.evaluate(() => window.packlab.diagnostics.get());
      if (!diagnostics.backendUrl) throw new Error('Backend URL missing from diagnostics');
      const live = await fetch(`${diagnostics.backendUrl}/health/live`).then((res) => res.json());
      if (live.status !== 'alive') throw new Error(`Unexpected /health/live response: ${JSON.stringify(live)}`);
      const ready = await fetch(`${diagnostics.backendUrl}/health/ready`).then((res) => res.json());
      if (!['ready', 'degraded'].includes(ready.status)) throw new Error(`Unexpected /health/ready response: ${JSON.stringify(ready)}`);
      const caps = await fetch(`${diagnostics.backendUrl}/capabilities`).then((res) => res.json());
      if (!caps.open3d || typeof caps.open3d.available !== 'boolean') throw new Error('Structured capability response missing open3d.available');
      await page.locator('#diagnostics-button').click();
      await page.waitForSelector('#diagnostics-dialog[open]', { timeout: 5000 });
      await page.keyboard.press('Escape').catch(() => {});

      if (['multiphoto', 'primary-unified', 'one-photo-unified'].includes(name)) {
        const screenshotDir = process.env.PACKLAB_MULTIPHOTO_SCREENSHOT_DIR || '';
        const tenFiles = createSmokePngFiles(10);
        if (name === 'primary-unified') {
          await page.setInputFiles('input.multi-photo__input', tenFiles.slice(0, 3));
          await page.waitForFunction(() => document.querySelectorAll('.photo-card').length === 3, null, { timeout: 15000 });
          await page.setInputFiles('input.multi-photo__input', tenFiles.slice(3, 8));
          await page.waitForFunction(() => document.querySelectorAll('.photo-card').length === 8, null, { timeout: 15000 });
          await page.setInputFiles('input.multi-photo__input', tenFiles.slice(8, 10));
        } else if (name === 'one-photo-unified') {
          await page.setInputFiles('input.multi-photo__input', tenFiles.slice(0, 1));
        } else {
          await page.setInputFiles('input.multi-photo__input', tenFiles);
        }
        const expectedInitialCount = name === 'one-photo-unified' ? 1 : 10;
        await page.waitForFunction((count) => document.querySelectorAll('.photo-card').length === count, expectedInitialCount, { timeout: 15000 });
        if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `phase4-10-photo-upload-${Date.now()}.png`), fullPage: true });
        const counterText = await page.locator('.multi-photo__counter').textContent();
        if (!counterText.includes(`${expectedInitialCount} / 10`)) throw new Error(`Expected ${expectedInitialCount}-photo counter, got: ${counterText}`);
        if (name !== 'one-photo-unified') {
          const thumbnailCount = await page.locator('.photo-card img').count();
          if (thumbnailCount !== 10) throw new Error(`Expected 10 thumbnails, got ${thumbnailCount}`);
        }

        if (name === 'multiphoto' || name === 'primary-unified') {
          await page.locator('.multi-photo__actions button', { hasText: 'Remove All' }).click();
          await page.waitForFunction(() => document.querySelectorAll('.photo-card').length === 0, null, { timeout: 5000 });
        }

        const reconstructionFiles = name === 'one-photo-unified' ? createSmokePngFiles(1) : createSmokePngFiles(4);
        if (name !== 'one-photo-unified') {
          await page.setInputFiles('input.multi-photo__input', reconstructionFiles);
        }
        await page.waitForFunction((count) => document.querySelectorAll('.photo-card').length === count, reconstructionFiles.length, { timeout: 15000 });
        await page.locator('.photo-card select').nth(0).selectOption('front');
        if (reconstructionFiles.length > 1) {
          await page.locator('.photo-card select').nth(1).selectOption('left');
          await page.locator('.photo-card select').nth(2).selectOption('back');
          await page.locator('.photo-card select').nth(3).selectOption('right');
        }
        if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `phase4-provider-status-${Date.now()}.png`), fullPage: true });
        const createButtonCount = await page.locator('.multi-photo__actions button', { hasText: 'Create Unified Design' }).count();
        if (createButtonCount !== 1) throw new Error(`Expected one Create Unified Design button, got ${createButtonCount}`);
        await page.locator('.multi-photo__actions button', { hasText: 'Create Unified Design' }).click();
        try {
          await page.waitForFunction(
            () => (document.querySelector('.multi-photo__report')?.textContent || '').includes('Fallback used: Yes'),
            null,
            { timeout: 90000 }
          );
        } catch (err) {
          const details = await page.evaluate(() => ({
            status: document.querySelector('#pipeline-status')?.textContent || '',
            progress: document.querySelector('.multi-photo__progress')?.textContent || '',
            report: document.querySelector('.multi-photo__report')?.textContent || '',
          }));
          throw new Error(`Multi-photo reconstruction report did not appear: ${JSON.stringify(details)}`);
        }
        const reportText = await page.locator('.multi-photo__report').textContent();
        if (!reportText.includes(`Photos used: ${reconstructionFiles.length}`)) throw new Error(`Expected unified ${reconstructionFiles.length}-photo report, got: ${reportText}`);
        if (!reportText.includes('Provider used:')) throw new Error(`Provider status missing from report: ${reportText}`);
        const pipelineStatus = await page.locator('#pipeline-status').textContent();
        if (pipelineStatus.includes('generate-mesh FAILED')) throw new Error(`Legacy generate-mesh failure leaked into primary workflow: ${pipelineStatus}`);
        if (!pipelineStatus.includes('Unified design generated using parametric fallback')) throw new Error(`Expected fallback success status, got: ${pipelineStatus}`);
        if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `phase4-unified-design-fallback-${Date.now()}.png`), fullPage: true });
      }
    }

    if (errors.some((item) => item.includes('ERR_FILE_NOT_FOUND') || item.includes('GLTFLoader') || item.includes('OrbitControls'))) {
      throw new Error(`Renderer console errors: ${errors.join('\n')}`);
    }

    const diagnostics = await page.evaluate(() => window.packlab.diagnostics.get());
    await closeApp(page, browser, child);
    await sleep(1500);
    const lingering = await listPackLabProcesses();
    if (lingering.length) throw new Error(`PackLab process still running after ${name} close: ${JSON.stringify(lingering)}`);
    return { name, ok: true, backendUrl: diagnostics.backendUrl, startupEvents: diagnostics.startupEvents, screenshot: capturePath };
  } catch (err) {
    if (browser && page) await closeApp(page, browser, child).catch(() => {});
    await killPackLabProcesses();
    throw err;
  }
}

(async () => {
  const results = [];
  for (let i = 0; i < scenarios.length; i += 1) {
    results.push(await runScenario(scenarios[i], i));
  }
  console.log(JSON.stringify({ ok: true, results }, null, 2));
})().catch((err) => {
  console.error(`[smoke-packaged] ERROR: ${err.stack || err.message}`);
  process.exit(1);
});
