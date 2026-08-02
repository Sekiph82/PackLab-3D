const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { launchPackLab } = require('./helpers/launchPackLab');

test('source Electron reaches readiness without obsolete model diagnostics', async () => {
  const launched = await launchPackLab();
  try {
    const { window } = launched;
    await expect(window.locator('#app[data-app-ready="true"]')).toHaveCount(1);
    await expect(window.locator('#loading-text')).toContainText('100%');
    const startupText = await window.locator('#startup-stages').textContent();
    expect(startupText).not.toMatch(/SAM|model unavailable/i);
    const diagnostics = launched.diagnostics();
    expect(diagnostics).toContain('app-when-ready');
    expect(diagnostics).toContain('window-creation-succeeded');
    expect(diagnostics).toContain('renderer-load-succeeded');
    expect(diagnostics).toContain('backend-spawn-succeeded');
    const screenshotDir = path.join(__dirname, '..', '..', '..', 'logs', 'claude');
    fs.mkdirSync(screenshotDir, { recursive: true });
    await window.screenshot({ path: path.join(screenshotDir, `phase7-1c-source-electron-ready-${Date.now()}.png`) });
  } finally {
    await launched.close();
  }
});
