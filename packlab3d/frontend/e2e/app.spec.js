// Real Playwright Electron E2E suite — installed and run for real (not scaffolded).
//
// Honest scope note: a true "photo -> generate mesh -> scale -> cleanup ->
// wall thickness -> 2D -> label -> label-to-3D -> viewer -> export" pipeline
// cannot complete in this environment because torch/segment-anything/TripoSR
// aren't installed (see Stage 3/backend/requirements-ml.txt) — /generate-mesh
// always returns 503. This suite verifies everything that *can* actually run
// end-to-end (app boot, i18n, form validation, photo upload plumbing, the
// graceful 503 failure path, and full label generation, which has no mesh
// dependency) and asserts the failure path is itself correct and localized,
// rather than skipping or faking the blocked step.
const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const APP_DIR = path.join(__dirname, '..');
const ARTIFACTS_DIR = path.join(__dirname, '..', '..', 'tests', 'e2e', 'artifacts');
const LOGS_DIR = path.join(__dirname, '..', '..', 'tests', 'e2e', 'logs');
const TEST_PHOTO = path.join(__dirname, '..', '..', '..', 'PackLab 3D logo pack', '16x16 px.png');
const BACKEND_PORT = '8010'; // avoids the port-8000 conflict documented in the Stage 8 log

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

// .serial() (not plain describe) — these tests share ONE Electron instance and
// depend on each other's state (photo upload -> mesh attempt -> label gen ->
// label-to-3d), so they must run in order without Playwright treating them as
// independently retriable/isolatable.
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
    fs.writeFileSync(path.join(LOGS_DIR, 'e2e_run.log'), runLog.join('\n') + '\n');
    fs.writeFileSync(path.join(LOGS_DIR, 'e2e_errors.log'), errorLog.join('\n') + '\n');
    await app.close();
    log('App closed.');
  });

  test('01 - splash screen appears, then hides once backend is ready', async () => {
    await window.screenshot({ path: path.join(ARTIFACTS_DIR, 'splash.png') });
    log('Captured splash.png');

    await window.waitForSelector('#app:not(.app--hidden)', { timeout: 30000 });
    // Real class is 'fade-out' (Stage 10 redesign) — this checked the old
    // Stage 8 class name 'splash--hidden', which stopped existing when the
    // splash was rewritten and has been silently wrong ever since. Using
    // expect(...).toHaveClass (auto-retrying) instead of a one-shot
    // getAttribute snapshot, since app.js adds the class via a deliberate
    // 500ms setTimeout independent of when #app becomes visible.
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
    await expect(window.locator('[data-i18n="nav.measurements"]')).toHaveText('Ölçümler');
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

  test('05 - photo upload plumbing works', async () => {
    await window.setInputFiles('#photo-uploader input[type="file"]', TEST_PHOTO);
    await expect(window.locator('#photo-uploader .uploader')).toHaveText('16x16 px.png');
    log('Photo uploaded into the FileUploader component.');
  });

  test('06 - generate-mesh fails gracefully with a localized message (torch/TripoSR not installed)', async () => {
    await window.getByRole('button', { name: /generate/i }).first().click();
    // Must wait for the FINAL status, not just non-empty — the button sets an
    // in-progress "generate-mesh..." placeholder first, which would otherwise
    // satisfy a naive "non-empty" check before the real result lands.
    await window.waitForFunction(
      () => document.getElementById('pipeline-status').textContent.includes('FAILED'),
      { timeout: 15000 }
    );
    const status = await window.locator('#pipeline-status').textContent();
    log(`Pipeline status after generate-mesh attempt: ${status}`);
    expect(status).toContain('FAILED');
    expect(status).toMatch(/model|AI/i);
  });

  test('07 - viewer canvas is mounted even with no model loaded', async () => {
    await expect(window.locator('#threejs-viewer canvas')).toBeVisible();
    await window.screenshot({ path: path.join(ARTIFACTS_DIR, 'viewer_loaded.png') });
    log('Captured viewer_loaded.png (empty scene — no mesh, generate-mesh is blocked in this environment).');
  });

  test('08 - label generation succeeds end-to-end (no mesh dependency) and preview renders', async () => {
    // style/shape default to minimal_modern/rectangle; pick a material for good measure.
    await window.locator('#material-selector select').selectOption('PET');
    await window.getByRole('button', { name: /label design/i }).click();

    // Wait for the actual completion signal (preview image src set on success)
    // rather than "status text non-empty", which the in-progress placeholder
    // would satisfy immediately too.
    await expect(window.locator('#label-preview')).toHaveAttribute('src', /^blob:/, { timeout: 15000 });
    const status = await window.locator('#pipeline-status').textContent();
    log(`Pipeline status after generate-label: ${status}`);
    expect(status).not.toContain('FAILED');
    await window.screenshot({ path: path.join(ARTIFACTS_DIR, 'label_preview.png') });
    log('Captured label_preview.png — real label PNG rendered client-side from the ZIP response.');
  });

  test('09 - apply-label-to-3d correctly refuses without a generated mesh', async () => {
    await window.getByRole('button', { name: /export/i }).click();
    await window.waitForFunction(
      () => document.getElementById('pipeline-status').textContent.includes('FAILED'),
      { timeout: 15000 }
    );
    const status = await window.locator('#pipeline-status').textContent();
    log(`Pipeline status after apply-label-to-3d attempt: ${status}`);
    expect(status).toContain('Generate a mesh and a label first');
  });
});
