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

function launchDirect({ port, forceBackendFail, forceLabelMappingTimeout, splashHoldMs }) {
  return spawn(exePath, [], {
    cwd: releaseRoot,
    windowsHide: true,
    env: {
      ...process.env,
      PACKLAB_REMOTE_DEBUGGING_PORT: String(port),
      PACKLAB_STARTUP_TIMEOUT_MS: '45000',
      PACKLAB_SPLASH_HOLD_MS: String(splashHoldMs || 0),
      ...(forceBackendFail ? { PACKLAB_FORCE_BACKEND_FAIL: '1' } : {}),
      ...(forceLabelMappingTimeout ? {
        PACKLAB_LABEL_MAPPING_TIMEOUT_SECONDS: '1',
        PACKLAB_FORCE_LABEL_MAPPING_SLEEP_SECONDS: '2',
      } : {}),
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
  const sourcePng = path.join(projectRoot, 'PackLab 3D logo pack', '512x512 px.png');
  const png = fs.existsSync(sourcePng)
    ? fs.readFileSync(sourcePng)
    : Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAADDPmHLAAABhUlEQVR4nO3bQQ6CMBBFQez/f2YLKbtQUkaTiUmMOWeT29whKLshSZEkSZLkeTvAR7EDzIDGpv7+znSef9Xn8TPOC7zc22vEtPn94+tFAmYMiRmvmwNexqMMH2trPFpMSt2s3Y9+pjEUjwLgS4LCp4+PZ4TnV+K8qQAr8vPnbv5TQvBtIBAAAgEAACAAAAgEAACAAAAgEAACAAAAgEAACAAAAgEAACAAAAgEAACAQASmrQLgr4T4T2JtIBAAAgEAACAAAAgEAACAAAAgEAACAAAAgEAACAAAAgEAACAAAAgEAACBQecgRr3Jy70EAACAAAAgEAACAAAAgEAACAAAAgEAACAAAAgEAACAAAAgEAACAAAAgEAACAROkTVBeSU/8CAgEAACAAAAgEAACAAAAgEAACAAAAgEAACAAAAgEAACAAAAgEAACAAAAgEAEqM9A8CIBAAAgEAACAAAAgEAACAAAAgEAACAAAAgEAACAAAAgEAACAAAAgEAACAQARRrvYiAQAAIBAIAAACg9YCNKVaCd1p2VEAAAAASUVORK5CYII=',
      'base64'
    );
  return Array.from({ length: count }, (_item, index) => {
    const filePath = path.join(claudeLogDir, `multi-photo-smoke-${index + 1}.png`);
    fs.writeFileSync(filePath, png);
    return filePath;
  });
}

async function dragLocator(page, locator, dx, dy) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Cannot drag invisible editor target');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

async function clickEditorButton(page, title, text) {
  await page.locator('.interactive-editor', { hasText: title }).locator('button', { hasText: text }).click();
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
    : launchDirect({
        port,
        forceBackendFail: name === 'degraded',
        forceLabelMappingTimeout: name === 'label-timeout',
        splashHoldMs: capturePath ? 5000 : 0,
      });

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

      const phase7Scenarios = [
        'photo-analysis',
        'same-object',
        'view-assignment',
        'mask-editor',
        'landmark-editor',
        'optimizer-monitor',
        'advanced-profile-editor',
        'advanced-section-editor',
        'control-cage',
        'dimension-editor',
        'section-view',
        'svg-dxf-validation',
        'version-compare',
        'autosave-recovery',
        'photo-geometry-mask',
        'photo-geometry-contour',
        'photo-geometry-landmark',
        'photo-geometry-reconstruction',
        'photo-geometry-reopen',
      ];
      if (['multiphoto', 'primary-unified', 'one-photo-unified', 'label-mapping', 'label-timeout', 'native-reconstruction', 'editable-3d', 'linked-2d', ...phase7Scenarios].includes(name)) {
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

        if (name === 'multiphoto' || name === 'primary-unified' || name === 'label-mapping' || name === 'label-timeout' || name === 'native-reconstruction' || name === 'editable-3d' || name === 'linked-2d' || phase7Scenarios.includes(name)) {
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
            () => (document.querySelector('.multi-photo__report')?.textContent || '').includes('Native Multi-Photo Reconstruction'),
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
        if (!pipelineStatus.includes('Unified design generated with PackLab native reconstruction')) throw new Error(`Expected native reconstruction success status, got: ${pipelineStatus}`);
        if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `phase4-unified-design-fallback-${Date.now()}.png`), fullPage: true });

        if (phase7Scenarios.includes(name)) {
          await page.waitForSelector('.optimizer-monitor', { timeout: 15000 });
          const cardText = await page.locator('.photo-card').first().textContent();
          if (!/Sharpness|Coverage|Assigned view/.test(cardText)) throw new Error(`Phase 7 photo diagnostics missing: ${cardText}`);
          const reportTextPhase7 = await page.locator('.multi-photo__report').textContent();
          if (!reportTextPhase7.includes('Per-view IoU')) throw new Error(`Phase 7 IoU summary missing: ${reportTextPhase7}`);
          const monitorText = await page.locator('.optimizer-monitor').textContent();
          if (!monitorText.includes('Objective terms')) throw new Error(`Objective term monitor missing: ${monitorText}`);
          if (screenshotDir) {
            await page.screenshot({ path: path.join(screenshotDir, `phase7-photo-quality-${Date.now()}.png`), fullPage: true });
            await page.screenshot({ path: path.join(screenshotDir, `phase7-optimizer-monitor-${Date.now()}.png`), fullPage: true });
          }
        }

        if (name === 'editable-3d' || name === 'linked-2d') {
          await page.waitForSelector('.native-editor', { timeout: 10000 });
          await page.waitForSelector('.profile-editor__canvas [data-profile-point-id]', { timeout: 10000 });
          await dragLocator(page, page.locator('.profile-editor__canvas [data-profile-point-id]').nth(1), 18, -8);
          await clickEditorButton(page, 'Profile Editor', 'Apply');
          await page.waitForFunction(
            () => (document.querySelector('#pipeline-status')?.textContent || '').includes('Profile edit regenerated'),
            null,
            { timeout: 60000 }
          );
          if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `phase6-editable-3d-${Date.now()}.png`), fullPage: true });
        }

        if (name === 'linked-2d') {
          await clickEditorButton(page, 'Linked 2D Drawing Workspace', 'Add Note');
          const drawingBox = await page.locator('.drawing-workspace__canvas').boundingBox();
          await page.mouse.click(drawingBox.x + 180, drawingBox.y + 120);
          await clickEditorButton(page, 'Linked 2D Drawing Workspace', 'Save');
          await page.waitForFunction(
            () => (document.querySelector('#pipeline-status')?.textContent || '').includes('Drawing edits saved'),
            null,
            { timeout: 15000 }
          );
          if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `phase6-linked-2d-${Date.now()}.png`), fullPage: true });
        }

        if (phase7Scenarios.includes(name)) {
          await page.waitForSelector('.native-editor', { timeout: 10000 });
          async function runProfileEdit() {
            await page.waitForSelector('.profile-editor__canvas [data-profile-point-id]', { timeout: 10000 });
            await dragLocator(page, page.locator('.profile-editor__canvas [data-profile-point-id]').nth(1), 18, -8);
            await clickEditorButton(page, 'Profile Editor', 'Apply');
            await page.waitForFunction(
              () => (document.querySelector('#pipeline-status')?.textContent || '').includes('Profile edit regenerated'),
              null,
              { timeout: 60000 }
            );
          }
          async function runSectionEdit() {
            await page.waitForSelector('.section-editor__canvas [data-handle="width"]', { timeout: 10000 });
            await dragLocator(page, page.locator('.section-editor__canvas [data-handle="width"]'), 16, 0);
            await clickEditorButton(page, 'Section Editor', 'Apply');
            await page.waitForFunction(
              () => (document.querySelector('#pipeline-status')?.textContent || '').includes('Section edit applied'),
              null,
              { timeout: 60000 }
            );
          }
          if (name === 'advanced-section-editor' || name === 'advanced-profile-editor') {
            if (name === 'advanced-profile-editor') await runProfileEdit();
            else await runSectionEdit();
            if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `phase7-section-editor-${Date.now()}.png`), fullPage: true });
          }
          if (name === 'control-cage') {
            await page.waitForSelector('.cage-editor__canvas [data-cage-node-id]', { timeout: 10000 });
            await dragLocator(page, page.locator('.cage-editor__canvas [data-cage-node-id]').nth(1), -18, -12);
            await clickEditorButton(page, 'Control Cage Editor', 'Apply');
            await page.waitForFunction(
              () => (document.querySelector('#pipeline-status')?.textContent || '').includes('Control cage edit'),
              null,
              { timeout: 60000 }
            );
            if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `phase7-control-cage-${Date.now()}.png`), fullPage: true });
          }
          if (name === 'dimension-editor') {
            await page.waitForSelector('.drawing-workspace__canvas [data-entity-kind="dimension"]', { timeout: 10000, state: 'attached' });
            await dragLocator(page, page.locator('.drawing-workspace__canvas [data-entity-kind="dimension"]').first(), 0, 18);
            await clickEditorButton(page, 'Linked 2D Drawing Workspace', 'Save');
            await page.waitForFunction(
              () => (document.querySelector('#pipeline-status')?.textContent || '').includes('Drawing edits saved'),
              null,
              { timeout: 15000 }
            );
            if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `phase7-dimension-editor-${Date.now()}.png`), fullPage: true });
          }
          if (name === 'section-view') {
            await clickEditorButton(page, 'Linked 2D Drawing Workspace', 'Add Section Line');
            const drawingBox = await page.locator('.drawing-workspace__canvas').boundingBox();
            await page.mouse.move(drawingBox.x + 90, drawingBox.y + 90);
            await page.mouse.down();
            await page.mouse.move(drawingBox.x + 170, drawingBox.y + 170, { steps: 6 });
            await page.mouse.up();
            await clickEditorButton(page, 'Linked 2D Drawing Workspace', 'Save');
            await page.waitForFunction(
              () => (document.querySelector('#pipeline-status')?.textContent || '').includes('Drawing edits saved'),
              null,
              { timeout: 15000 }
            );
            if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `phase7-section-view-${Date.now()}.png`), fullPage: true });
          }
          if (name === 'landmark-editor') {
            await page.waitForSelector('.landmark-editor__canvas [data-landmark-id]', { timeout: 10000 });
            await dragLocator(page, page.locator('.landmark-editor__canvas [data-landmark-id]').first(), 28, -20);
            await clickEditorButton(page, 'Landmark Editor', 'Save');
            await page.waitForFunction(
              () => (document.querySelector('#pipeline-status')?.textContent || '').includes('Landmark correction'),
              null,
              { timeout: 15000 }
            );
            if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `phase7-landmark-editor-${Date.now()}.png`), fullPage: true });
          }
          if (name === 'mask-editor') {
            await page.waitForSelector('.mask-editor__canvas', { timeout: 10000 });
            await dragLocator(page, page.locator('.mask-editor__canvas'), 22, 18);
            await clickEditorButton(page, 'Mask Editor', 'Save Mask');
            await page.waitForFunction(
              () => (document.querySelector('#pipeline-status')?.textContent || '').includes('Manual mask saved'),
              null,
              { timeout: 15000 }
            );
            if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `phase7-mask-editor-${Date.now()}.png`), fullPage: true });
          }
          if (name === 'photo-geometry-mask' || name === 'photo-geometry-contour' || name === 'photo-geometry-landmark' || name === 'photo-geometry-reconstruction' || name === 'photo-geometry-reopen') {
            await page.locator('.photo-card button', { hasText: 'Edit Geometry' }).first().click();
            await page.waitForSelector('.photo-geometry-workspace', { timeout: 15000 });
            await page.waitForSelector('.mask-editor__canvas', { timeout: 10000 });
            await dragLocator(page, page.locator('.mask-editor__canvas').first(), 24, 16);
            const maskSave = page.waitForResponse((response) => response.url().includes('/mask') && response.request().method() === 'PUT', {
              timeout: 15000,
            });
            await page.locator('.photo-geometry-workspace button', { hasText: 'Save Mask' }).click();
            const maskResponse = await maskSave;
            if (!maskResponse.ok()) throw new Error(`Manual mask save failed with HTTP ${maskResponse.status()}`);
            const maskBody = await maskResponse.json();
            if (!maskBody.geometry?.revisions?.manualMask) throw new Error('Manual mask save did not increment manualMask revision.');
            await page.waitForFunction(
              () => /Mask rev:\s*[1-9]/i.test(document.querySelector('.photo-geometry-workspace')?.textContent || ''),
              null,
              { timeout: 15000 }
            );
            if (name === 'photo-geometry-contour' || name === 'photo-geometry-reconstruction' || name === 'photo-geometry-reopen') {
              await page.locator('.photo-geometry-workspace button', { hasText: 'Contour' }).click();
              await page.waitForSelector('.photo-geometry-workspace .contour-editor__canvas [data-contour-point-id]', { timeout: 10000 });
              await dragLocator(page, page.locator('.photo-geometry-workspace .contour-editor__canvas [data-contour-point-id]').nth(3), 6, 4);
              const contourSave = page.waitForResponse((response) => response.url().includes('/contour') && response.request().method() === 'PUT', {
                timeout: 15000,
              }).catch(async (err) => {
                const contourText = await page.locator('.photo-geometry-workspace .contour-editor__validation').textContent().catch(() => '');
                throw new Error(`${err.message}; contour editor state: ${contourText}`);
              });
              await page.locator('.photo-geometry-workspace .contour-editor__toolbar button', { hasText: /^Save$/ }).click();
              const contourResponse = await contourSave;
              if (!contourResponse.ok()) throw new Error(`Manual contour save failed with HTTP ${contourResponse.status()}`);
              const contourBody = await contourResponse.json();
              if (!contourBody.geometry?.revisions?.manualContour) throw new Error('Manual contour save did not increment manualContour revision.');
              await page.waitForFunction(
                () => /Contour rev:\s*[1-9]/i.test(document.querySelector('.photo-geometry-workspace')?.textContent || ''),
                null,
                { timeout: 15000 }
              );
            }
            if (name === 'photo-geometry-landmark' || name === 'photo-geometry-reconstruction' || name === 'photo-geometry-reopen') {
              await page.locator('.photo-geometry-workspace button', { hasText: 'Landmarks' }).click();
              await page.waitForSelector('.photo-geometry-workspace .landmark-editor__canvas [data-landmark-id]', { timeout: 10000 });
              await dragLocator(page, page.locator('.photo-geometry-workspace .landmark-editor__canvas [data-landmark-id]').first(), 20, -12);
              const landmarkPanel = page.locator('.photo-geometry-workspace .interactive-editor', { hasText: 'Landmark Editor' });
              await landmarkPanel.locator('button', { hasText: 'Lock/Unlock' }).click();
              const landmarkSave = page.waitForResponse((response) => response.url().includes('/landmarks') && response.request().method() === 'PUT', {
                timeout: 15000,
              });
              await landmarkPanel.locator('button', { hasText: /^Save$/ }).click();
              const landmarkResponse = await landmarkSave;
              if (!landmarkResponse.ok()) throw new Error(`Landmark save failed with HTTP ${landmarkResponse.status()}`);
              const landmarkBody = await landmarkResponse.json();
              if (!landmarkBody.geometry?.revisions?.landmarks) throw new Error('Landmark save did not increment landmark revision.');
            }
            if (name === 'photo-geometry-reconstruction' || name === 'photo-geometry-reopen') {
              await page.locator('.multi-photo__actions button', { hasText: 'Create Unified Design' }).click();
              await page.waitForFunction(
                () => (document.querySelector('.multi-photo__report')?.textContent || '').includes('Unified reconstruction complete.'),
                null,
                { timeout: 90000 }
              );
            }
            if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `phase7-1b-${name}-${Date.now()}.png`), fullPage: true });
          }
          if (name === 'version-compare' || name === 'autosave-recovery') {
            await page.locator('.version-manager__list').waitFor({ timeout: 10000 });
            await page.locator('.interactive-editor', { hasText: 'Version Manager' }).locator('input').first().fill('Smoke Version A');
            await page.locator('.interactive-editor', { hasText: 'Version Manager' }).locator('button', { hasText: 'Save Version' }).click();
            await page.waitForFunction(
              () => (document.querySelector('#pipeline-status')?.textContent || '').includes('Project version saved'),
              null,
              { timeout: 15000 }
            );
            await runSectionEdit();
            await page.locator('.interactive-editor', { hasText: 'Version Manager' }).locator('input').first().fill('Smoke Version B');
            await page.locator('.interactive-editor', { hasText: 'Version Manager' }).locator('button', { hasText: 'Save Version' }).click();
            await page.locator('.interactive-editor', { hasText: 'Version Manager' }).locator('button', { hasText: 'Compare Versions' }).click();
            await page.waitForFunction(
              () => (document.querySelector('#pipeline-status')?.textContent || '').includes('Versions compared'),
              null,
              { timeout: 15000 }
            );
            if (name === 'autosave-recovery') {
              await page.locator('.autosave-status button', { hasText: 'Save Recovery Now' }).click();
              await page.waitForSelector('.autosave-status', { timeout: 5000 });
            }
            if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `phase7-version-compare-${Date.now()}.png`), fullPage: true });
          }
          if (name === 'svg-dxf-validation') {
            const validationText = await page.locator('.multi-photo__report').textContent();
            if (!validationText.includes('SVG: Valid') || !validationText.includes('DXF: Valid')) {
              throw new Error(`SVG/DXF validation result missing: ${validationText}`);
            }
            if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `phase7-svg-dxf-validation-${Date.now()}.png`), fullPage: true });
          }
        }

        if (name === 'label-mapping' || name === 'label-timeout') {
          await page.locator('#export-panel button', { hasText: 'Label Design' }).click();
          try {
            await page.waitForFunction(
              () => (document.querySelector('#pipeline-status')?.textContent || '').includes('Label generated successfully'),
              null,
              { timeout: 30000 }
            );
          } catch (err) {
            const details = await page.evaluate(() => ({
              status: document.querySelector('#pipeline-status')?.textContent || '',
              buttons: [...document.querySelectorAll('#export-panel button')].map((button) => ({
                text: button.textContent,
                disabled: button.disabled,
              })),
              previewSrc: document.querySelector('#label-preview')?.getAttribute('src') || '',
            }));
            throw new Error(`Label generation did not complete: ${JSON.stringify(details)}`);
          }
          await page.locator('.label-mapping select').selectOption(name === 'label-mapping' ? 'cylindrical' : 'box');
          await page.locator('#export-panel button', { hasText: 'Apply Label to 3D' }).click();
          if (name === 'label-timeout') {
            await page.waitForFunction(
              () => (document.querySelector('#pipeline-status')?.textContent || '').includes('Label application took too long'),
              null,
              { timeout: 30000 }
            );
            const diagnostics = await page.evaluate(() => window.packlab.diagnostics.get());
            const live = await fetch(`${diagnostics.backendUrl}/health/live`).then((res) => res.json());
            if (live.status !== 'alive') throw new Error(`Backend not responsive after label timeout: ${JSON.stringify(live)}`);
            if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `phase5-label-timeout-${Date.now()}.png`), fullPage: true });
          } else {
            try {
              await page.waitForFunction(
                () => {
                  const text = document.querySelector('#pipeline-status')?.textContent || '';
                  return text.includes('Viewer load completed') || text.includes('Label applied to 3D model.');
                },
                null,
                { timeout: 60000 }
              );
            } catch (err) {
              const details = await page.evaluate(() => ({
                status: document.querySelector('#pipeline-status')?.textContent || '',
                exportButtons: [...document.querySelectorAll('#export-panel button')].map((button) => ({
                  text: button.textContent,
                  disabled: button.disabled,
                })),
                canvasCount: document.querySelectorAll('#threejs-viewer canvas').length,
              }));
              throw new Error(`Label mapping did not complete viewer load: ${JSON.stringify(details)}`);
            }
            const glbLoaded = await page.evaluate(() => Boolean(window.packlab?.diagnostics?.get));
            if (!glbLoaded) throw new Error('Label mapping completed but diagnostics bridge disappeared');
            if (screenshotDir) {
              await page.screenshot({ path: path.join(screenshotDir, `phase5-label-mapping-${Date.now()}.png`), fullPage: true });
              await page.locator('#language-switcher button[data-lang="tr"]').click();
              await page.screenshot({ path: path.join(screenshotDir, `phase5-localization-tr-${Date.now()}.png`), fullPage: true });
              await page.locator('#language-switcher button[data-lang="sw"]').click();
              await page.screenshot({ path: path.join(screenshotDir, `phase5-localization-sw-${Date.now()}.png`), fullPage: true });
            }
          }
        }
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
