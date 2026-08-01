// Real Playwright Electron E2E suite. The primary desktop workflow is the
// unified photo-set reconstruction job, not the optional legacy TripoSR
// /generate-mesh endpoint.
const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const APP_DIR = path.join(__dirname, '..');
const ARTIFACTS_DIR = path.join(__dirname, '..', '..', 'tests', 'e2e', 'artifacts');
const LOGS_DIR = path.join(__dirname, '..', '..', 'tests', 'e2e', 'logs');
const TEST_PHOTO = path.join(__dirname, '..', '..', '..', 'PackLab 3D logo pack', '16x16 px.png');
const BACKEND_PORT = '8010';

fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
fs.mkdirSync(LOGS_DIR, { recursive: true });

const runLog = [];
const errorLog = [];

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  runLog.push(line);
  console.log(line);
}

function logError(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  errorLog.push(line);
  console.error(line);
}

// These tests share one Electron instance and depend on state created by
// previous steps, so they must run serially.
test.describe.serial('PackLab 3D desktop app (real end-to-end run)', () => {
  let app;
  let window;

  test.beforeAll(async () => {
    log(`Launching Electron app from ${APP_DIR} with PACKLAB_BACKEND_PORT=${BACKEND_PORT}`);
    app = await electron.launch({
      args: [APP_DIR],
      env: { ...process.env, PACKLAB_BACKEND_PORT: BACKEND_PORT },
    });
    window = await app.firstWindow();
    window.on('console', (msg) => log(`[renderer console] ${msg.text()}`));
    window.on('pageerror', (err) => logError(`[renderer error] ${err.message}`));
  });

  test.afterAll(async () => {
    fs.writeFileSync(path.join(LOGS_DIR, 'e2e_run.log'), `${runLog.join('\n')}\n`);
    fs.writeFileSync(path.join(LOGS_DIR, 'e2e_errors.log'), `${errorLog.join('\n')}\n`);
    await app.close();
    log('App closed.');
  });

  test('01 - splash screen appears, then hides once backend is ready', async () => {
    await window.screenshot({ path: path.join(ARTIFACTS_DIR, 'splash.png') });
    log('Captured splash.png');

    await window.waitForSelector('#app:not(.app--hidden)', { timeout: 30000 });
    await expect(window.locator('#splash')).toHaveClass(/fade-out/, { timeout: 5000 });
    log('Splash hidden, backend reported ready.');
  });

  test('02 - 4-panel layout and main UI render', async () => {
    await expect(window.locator('.panel--left')).toBeVisible();
    await expect(window.locator('.panel--center')).toBeVisible();
    await expect(window.locator('.panel--right')).toBeVisible();
    await expect(window.locator('.panel--bottom')).toBeVisible();
    await window.screenshot({ path: path.join(ARTIFACTS_DIR, 'main_ui.png') });
    log('Captured main_ui.png');
  });

  test('03 - language switch updates UI text instantly', async () => {
    await window.locator('#language-switcher button[data-lang="tr"]').click();
    await expect(window.locator('[data-i18n="nav.measurements"]')).not.toHaveText('Measurements');
    await window.locator('#language-switcher button[data-lang="en"]').click();
    await expect(window.locator('[data-i18n="nav.measurements"]')).toHaveText('Measurements');
    log('Language switch verified (TR then back to EN).');
  });

  test('04 - measurement form validation error shows for empty dimensions', async () => {
    const errorText = await window.locator('[data-form-error="dimensions"]').textContent();
    expect(errorText).toBe('This field is required.');
    log('Measurement form validation error confirmed.');

    await window.locator('.panel--left input[type="number"]').first().fill('80');
    await expect(window.locator('[data-form-error="dimensions"]')).toHaveCount(0);
    log('Validation error clears once a dimension is provided.');
  });

  test('05 - multi-photo upload plumbing works', async () => {
    await window.setInputFiles('#photo-uploader input[type="file"]', TEST_PHOTO);
    await expect(window.locator('#photo-uploader .photo-card')).toHaveCount(1);
    await expect(window.locator('#photo-uploader .multi-photo__counter')).toContainText('1 / 10');
    log('Photo uploaded into the MultiPhotoUploader component.');
  });

  test('06 - unified reconstruction succeeds without legacy AI dependencies', async () => {
    await expect(window.getByRole('button', { name: /generate/i })).toHaveCount(0);
    await window.getByRole('button', { name: /create unified design/i }).click();
    await window.waitForFunction(
      () => (document.querySelector('.multi-photo__report')?.textContent || '').includes('Unified reconstruction complete.'),
      { timeout: 30000 }
    );
    const status = await window.locator('#pipeline-status').textContent();
    log(`Pipeline status after unified reconstruction: ${status}`);
    expect(status).toContain('Unified reconstruction complete');
    expect(status).toMatch(/parametric|fallback/i);
  });

  test('07 - viewer canvas is mounted after unified reconstruction', async () => {
    await expect(window.locator('#threejs-viewer canvas')).toBeVisible();
    await window.screenshot({ path: path.join(ARTIFACTS_DIR, 'viewer_loaded.png') });
    log('Captured viewer_loaded.png after unified reconstruction.');
  });

  test('08 - label generation succeeds end-to-end and preview renders', async () => {
    await window.locator('#material-selector select').selectOption('PET');
    await window.getByRole('button', { name: /label design/i }).click();

    await expect(window.locator('#label-preview')).toHaveAttribute('src', /^blob:/, { timeout: 15000 });
    const status = await window.locator('#pipeline-status').textContent();
    log(`Pipeline status after generate-label: ${status}`);
    expect(status).not.toContain('FAILED');
    await window.screenshot({ path: path.join(ARTIFACTS_DIR, 'label_preview.png') });
    log('Captured label_preview.png.');
  });

  test('09 - primary workflow never exposes the legacy generate-mesh failure', async () => {
    const status = await window.locator('#pipeline-status').textContent();
    log(`Final primary workflow status: ${status}`);
    expect(status).not.toContain('FAILED');
    expect(status).not.toContain('generate-mesh');
    await expect(window.getByRole('button', { name: /create unified design/i })).toBeVisible();
    await expect(window.getByRole('button', { name: /generate mesh/i })).toHaveCount(0);
  });
});
