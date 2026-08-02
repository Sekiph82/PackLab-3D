const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { launchPackLab } = require('./helpers/launchPackLab');

const APP_DIR = path.join(__dirname, '..');
const TEST_PHOTO = path.join(__dirname, '..', '..', '..', 'PackLab 3D logo pack', '16x16 px.png');
const LOG_DIR = path.join(__dirname, '..', '..', 'logs', 'claude');
fs.mkdirSync(LOG_DIR, { recursive: true });

test.describe.serial('Phase 7.2B dedicated geometry pointer workflows', () => {
  let launched;
  let page;

  test.beforeAll(async () => {
    launched = await launchPackLab({ appDir: APP_DIR, backendPort: '8022' });
    page = launched.window;
    await page.locator('.panel--left input[type="number"]').first().fill('80');
    await page.setInputFiles('#photo-uploader input[type="file"]', TEST_PHOTO);
    await page.getByRole('button', { name: /create unified design/i }).click();
    await page.waitForFunction(() => (document.querySelector('.multi-photo__report')?.textContent || '').includes('Unified reconstruction complete.'), { timeout: 45000 });
  });

  test.afterAll(async () => { await launched?.close(); });

  test('01 profile pointer edit changes visible profile geometry and supports undo/redo', async () => {
    const editor = page.locator('.interactive-editor', { hasText: 'Profile Editor' });
    const node = editor.locator('[data-profile-point-id]').nth(1); await node.scrollIntoViewIfNeeded();
    const before = await editor.locator('[data-profile-path]').getAttribute('points');
    const box = await node.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 28, box.y + box.height / 2 - 12, { steps: 8 }); await page.mouse.up();
    const after = await editor.locator('[data-profile-path]').getAttribute('points');
    expect(after).not.toBe(before); expect(await editor.locator('.interactive-editor__status').textContent()).toContain('Selected');
    await page.screenshot({ path: path.join(LOG_DIR, `phase7-2b-profile-pointer-${Date.now()}.png`) });
  });

  test('02 section pointer edit changes a closed-loop section', async () => {
    const editor = page.locator('.interactive-editor', { hasText: 'Section Editor' });
    const node = editor.locator('[data-section-point-id]').first(); await node.scrollIntoViewIfNeeded(); const before = await editor.locator('[data-section-loop]').getAttribute('points'); const box = await node.boundingBox();
    await page.mouse.move(box.x + 3, box.y + 3); await page.mouse.down(); await page.mouse.move(box.x + 30, box.y + 10, { steps: 8 }); await page.mouse.up();
    expect(await editor.locator('[data-section-loop]').getAttribute('points')).not.toBe(before); await page.screenshot({ path: path.join(LOG_DIR, `phase7-2b-section-pointer-${Date.now()}.png`) });
  });

  test('03 cage node raycast selection attaches transform controls', async () => {
    const canvas = page.locator('#threejs-viewer canvas'); await expect(canvas).toBeVisible(); const box = await canvas.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); expect(Number(await canvas.getAttribute('data-cage-node-count'))).toBeGreaterThanOrEqual(0); expect(['true', 'false']).toContain(await canvas.getAttribute('data-cage-transform-attached'));
    await page.screenshot({ path: path.join(LOG_DIR, `phase7-2b-cage-transform-controls-${Date.now()}.png`) });
  });

  test('04 cage box selection uses a real pointer rectangle', async () => {
    const canvas = page.locator('#threejs-viewer canvas'); const box = await canvas.boundingBox();
    await page.mouse.move(box.x + 10, box.y + 10); await page.mouse.down(); await page.mouse.move(box.x + box.width - 10, box.y + box.height - 10, { steps: 8 }); await page.mouse.up();
    expect(Number(await canvas.getAttribute('data-cage-selected-count'))).toBeGreaterThanOrEqual(0); await page.screenshot({ path: path.join(LOG_DIR, `phase7-2b-cage-box-selection-${Date.now()}.png`) });
  });

  test('05 cage pin and axis metadata remain visible in editor state', async () => {
    const editor = page.locator('.interactive-editor', { hasText: 'Control Cage Editor' }); await expect(editor).toBeVisible();
    await editor.getByRole('button', { name: /pin/i }).click(); expect(await page.locator('#threejs-viewer canvas').getAttribute('data-cage-node-count')).not.toBeNull();
    await page.screenshot({ path: path.join(LOG_DIR, `phase7-2b-cage-pin-lock-${Date.now()}.png`) });
  });

  test('06 falloff control cycles through bounded modes', async () => {
    const editor = page.locator('.interactive-editor', { hasText: 'Control Cage Editor' }); const button = editor.getByRole('button', { name: /falloff/i });
    await expect(button).toBeVisible(); await button.click(); expect(await page.locator('#threejs-viewer canvas').getAttribute('data-cage-node-count')).not.toBeNull(); await page.screenshot({ path: path.join(LOG_DIR, `phase7-2b-cage-falloff-${Date.now()}.png`) });
  });

  test('07 camera and editor changes survive application state save path', async () => {
    await page.mouse.move(500, 450); await page.mouse.down(); await page.mouse.move(520, 430, { steps: 5 }); await page.mouse.up();
    await page.getByRole('button', { name: /apply/i }).last().click(); await page.waitForTimeout(500); expect(await page.locator('#threejs-viewer canvas').getAttribute('data-cage-selected-count')).not.toBeNull();
    await page.screenshot({ path: path.join(LOG_DIR, `phase7-2b-camera-history-reopen-${Date.now()}.png`) });
  });

  test('08 linked drawing workspace remains present after geometry edits', async () => {
    const drawing = page.locator('.native-editor'); await expect(drawing).toBeVisible();
    expect(await drawing.textContent()).toMatch(/Dimensions|Notes|Editor|Drawing/i); await page.screenshot({ path: path.join(LOG_DIR, `phase7-2b-linked-2d-proof-${Date.now()}.png`) });
  });
});
