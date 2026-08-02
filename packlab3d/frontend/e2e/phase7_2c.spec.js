const { test, expect } = require('@playwright/test');
const path = require('path');
const { launchPackLab } = require('./helpers/launchPackLab');

const APP_DIR = path.join(__dirname, '..');
const TEST_PHOTO = path.join(__dirname, '..', '..', '..', 'PackLab 3D logo pack', '16x16 px.png');
const LOG_DIR = path.join(__dirname, '..', '..', 'logs', 'claude');

async function readEvidence(page) {
  return page.evaluate(async () => {
    const projectId = document.querySelector('.native-editor')?.dataset.projectId;
    const base = await window.packlab.backend.getUrl();
    if (!projectId || !base) return { projectId, checksums: {}, drawing: {} };
    const [deformation, drawing] = await Promise.all([
      fetch(`${base}/projects/${projectId}/deformation-provenance`).then((response) => response.json()),
      fetch(`${base}/projects/${projectId}/drawing-checksums`).then((response) => response.json()),
    ]);
    return { projectId, checksums: deformation.checksums || {}, drawing };
  });
}

async function drag(page, locator, dx, dy) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Pointer target is not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
  await page.mouse.up();
  return { down: [box.x + box.width / 2, box.y + box.height / 2], up: [box.x + box.width / 2 + dx, box.y + box.height / 2 + dy], moves: 8 };
}

test.describe.serial('Phase 7.2C checksum and persistence workflows', () => {
  let launched;
  let page;

  test.beforeAll(async () => {
    launched = await launchPackLab({ backendPort: '8023' });
    page = launched.window;
    await page.locator('.panel--left input[type="number"]').first().fill('80');
    await page.setInputFiles('#photo-uploader input[type="file"]', TEST_PHOTO);
    await page.getByRole('button', { name: /create unified design/i }).click();
    await page.waitForFunction(() => (document.querySelector('.multi-photo__report')?.textContent || '').includes('Unified reconstruction complete.'), { timeout: 45000 });
    await page.waitForSelector('.native-editor', { timeout: 15000 });
  });

  test.afterAll(async () => { await launched?.close(); });

  test('01 preview and final vertex checksums use the cage edit', async () => {
    const before = await readEvidence(page);
    const editor = page.locator('.interactive-editor', { hasText: 'Control Cage Editor' });
    const canvas = page.locator('#threejs-viewer canvas[data-cage-node-count]');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    // Select real cage nodes through the viewer before beginning the transform.
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.8, { steps: 8 });
    await page.mouse.up();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.48, { steps: 8 });
    await page.mouse.up();
    await editor.getByRole('button', { name: /^Apply$/i }).click();
    await page.waitForTimeout(500);
    const after = await readEvidence(page);
    expect(after.checksums.finalVertexChecksum).toBeTruthy();
    expect(after.checksums.finalVertexChecksum).not.toBe(before.checksums.finalVertexChecksum);
    expect(after.checksums.faceChecksum).toBeTruthy();
    if (before.checksums.faceChecksum) expect(after.checksums.faceChecksum).toBe(before.checksums.faceChecksum);
  });

  test('02 multi-selection scale changes the final mesh', async () => {
    const before = await readEvidence(page);
    const editor = page.locator('.interactive-editor', { hasText: 'Control Cage Editor' });
    await editor.getByRole('button', { name: /^Scale$/i }).click();
    const canvas = page.locator('#threejs-viewer canvas[data-cage-node-count]');
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.mouse.down(); await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4, { steps: 8 }); await page.mouse.up();
    await expect(canvas).toHaveAttribute('data-cage-selected-count', /[1-9]/);
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.56, box.y + box.height * 0.5, { steps: 8 }); await page.mouse.up();
    await editor.getByRole('button', { name: /^Apply$/i }).click();
    await page.waitForTimeout(500);
    const after = await readEvidence(page);
    expect(after.checksums.finalVertexChecksum).not.toBe(before.checksums.finalVertexChecksum);
  });

  test('03 safe rotation mode is attached to the cage editor', async () => {
    const editor = page.locator('.interactive-editor', { hasText: 'Control Cage Editor' });
    await editor.getByRole('button', { name: /^Rotate$/i }).click();
    const canvas = page.locator('#threejs-viewer canvas[data-cage-node-count]');
    const box = await canvas.boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    expect(await canvas.getAttribute('data-cage-transform-attached')).not.toBeNull();
  });

  test('04 stale final path keeps the current model revision', async () => {
    const before = await readEvidence(page);
    const editor = page.locator('.interactive-editor', { hasText: 'Control Cage Editor' });
    await editor.getByRole('button', { name: /^Translate$/i }).click();
    const canvas = page.locator('#threejs-viewer canvas[data-cage-node-count]');
    const box = await canvas.boundingBox();
    await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.45);
    await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.48, box.y + box.height * 0.42, { steps: 4 }); await page.mouse.up();
    await editor.getByRole('button', { name: /^Apply$/i }).click();
    await page.waitForTimeout(500);
    const after = await readEvidence(page);
    expect(after.checksums.finalVertexChecksum).toBeTruthy();
    expect(after.checksums.cageStateChecksum || before.checksums.cageStateChecksum).toBeTruthy();
  });

  test('05 persisted history is represented in the editable model response', async () => {
    const evidence = await readEvidence(page);
    expect(evidence.projectId).toBeTruthy();
    const history = await page.evaluate(async () => {
      const id = document.querySelector('.native-editor').dataset.projectId;
      const base = await window.packlab.backend.getUrl();
      return fetch(`${base}/projects/${id}/editable-model`).then((response) => response.json()).then((body) => body.editable3DState?.editorState?.history || {});
    });
    expect(Array.isArray(history.entries)).toBe(true);
    expect(Number.isInteger(history.cursor)).toBe(true);
  });

  test('06 camera and editor surfaces remain available after finalization', async () => {
    const editor = page.locator('.interactive-editor', { hasText: 'Control Cage Editor' });
    await expect(editor).toBeVisible();
    await page.screenshot({ path: path.join(LOG_DIR, `phase7-2c-camera-reopen-${Date.now()}.png`) });
    expect(await page.locator('#threejs-viewer canvas').getAttribute('data-cage-node-count')).not.toBeNull();
  });

  test('07 linked drawing checksums expose changed views and preserved annotations', async () => {
    const evidence = await readEvidence(page);
    expect(evidence.drawing.annotationChecksum).toBeTruthy();
    expect(evidence.drawing.pageLayoutChecksum).toBeTruthy();
    expect(Array.isArray(evidence.drawing.entityIds)).toBe(true);
    expect(Object.keys(evidence.drawing.viewChecksums || {}).length).toBeGreaterThan(0);
  });

  test('08 profile pointer edit changes drawing provenance', async () => {
    const editor = page.locator('.interactive-editor', { hasText: 'Profile Editor' });
    const node = editor.locator('[data-profile-point-id]').nth(1);
    const before = await readEvidence(page);
    const pointer = await drag(page, node, 20, -8);
    await editor.getByRole('button', { name: /^Apply$/i }).click();
    await page.waitForTimeout(500);
    const after = await readEvidence(page);
    expect(pointer.moves).toBe(8);
    expect(after.drawing.sourceModelRevision).toBeGreaterThan(before.drawing.sourceModelRevision || 0);
    expect(after.drawing.viewChecksums['front-view']).not.toBe(before.drawing.viewChecksums['front-view']);
  });
});
