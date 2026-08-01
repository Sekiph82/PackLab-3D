const { app, BrowserWindow, ipcMain, dialog, nativeImage, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createLogger, ensureLogDir, getLogDir } = require('./logger');
const { findAvailablePort, startBackend, stopBackend, waitForEndpoint } = require('./backend-process');

const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');
const LOGO_PACK_DIR = path.join(PROJECT_ROOT, 'PackLab 3D logo pack');
const WINDOW_ICON_PATH = path.join(LOGO_PACK_DIR, '512x512 px.png');
const STARTUP_TIMEOUT_MS = Number(process.env.PACKLAB_STARTUP_TIMEOUT_MS) || 60000;

let backendProcess = null;
let backendInfo = null;
let backendReadyPromise = null;
let resolveBackendReady = null;
let mainWindow = null;
let startupLogger = null;
let electronLogger = null;
let startupStartedAt = Date.now();
const startupEvents = [];

function packageInfo() {
  const pkgPath = path.join(__dirname, '..', 'package.json');
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch (err) {
    return { version: 'unknown' };
  }
}

function emitStartup(stage, state, detail = {}) {
  const event = {
    timestamp: new Date().toISOString(),
    elapsedMs: Date.now() - startupStartedAt,
    stage,
    state,
    ...detail,
  };
  startupEvents.push(event);
  startupLogger?.info('startup stage', event);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('startup:stage', event);
    const complete = startupEvents.filter((item) => item.state === 'success' || item.state === 'warning').length;
    mainWindow.webContents.send('backend:progress', Math.min(100, Math.round((complete / 9) * 100)));
  }
  return event;
}

function writeCrash(error, context = {}) {
  const logDir = ensureLogDir();
  fs.writeFileSync(
    path.join(logDir, 'last-crash.json'),
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        message: error.message,
        stack: error.stack,
        ...context,
      },
      null,
      2
    )
  );
}

function createWindow() {
  emitStartup('Desktop interface started', 'running');
  const rendererIndex = path.join(__dirname, 'renderer', 'dist', 'index.html');
  const fallbackIndex = path.join(__dirname, 'renderer', 'index.html');
  const indexPath = fs.existsSync(rendererIndex) ? rendererIndex : fallbackIndex;

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#0A0A0A',
    icon: fs.existsSync(WINDOW_ICON_PATH) ? nativeImage.createFromPath(WINDOW_ICON_PATH) : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.on('did-finish-load', () => {
    emitStartup('Renderer DOM ready', 'success', { indexPath });
    startupEvents.forEach((event) => mainWindow.webContents.send('startup:stage', event));
  });
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    electronLogger.info('renderer console', { level, message, line, sourceId });
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    emitStartup('Renderer load failed', 'error', { errorCode, errorDescription, validatedURL });
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });

  mainWindow.loadFile(indexPath);
  emitStartup('Main window creation', 'success', { indexPath });
}

async function bootBackend() {
  try {
    const port = await findAvailablePort();
    emitStartup('Backend executable lookup', 'success', { port, packaged: app.isPackaged });
    backendInfo = startBackend({
      app,
      projectRoot: PROJECT_ROOT,
      port,
      logDir: getLogDir(),
      logger: electronLogger,
    });
    backendProcess = backendInfo.child;
    emitStartup('Backend process launched', 'success', {
      pid: backendProcess.pid,
      port,
      backendUrl: backendInfo.backendUrl,
      executable: backendInfo.exePath || backendInfo.command,
    });

    let sawOutput = false;
    backendProcess.stdout?.once('data', () => {
      sawOutput = true;
      emitStartup('First backend output', 'success');
    });
    backendProcess.stderr?.once('data', () => {
      if (!sawOutput) emitStartup('First backend output', 'warning', { stream: 'stderr' });
    });

    const live = await waitForEndpoint(`${backendInfo.backendUrl}/health/live`, {
      timeoutMs: STARTUP_TIMEOUT_MS,
      onAttempt: (_attempt, elapsedMs) => {
        if (elapsedMs > 1000 && elapsedMs < 1400) emitStartup('Health endpoint available', 'running');
      },
    });
    if (!live.ok) throw new Error(`Backend health timeout after ${live.elapsedMs} ms`);
    emitStartup('Health endpoint available', 'success', { healthElapsedMs: live.elapsedMs, attempts: live.attempts });

    const readyResponse = await fetch(`${backendInfo.backendUrl}/health/ready`);
    const ready = await readyResponse.json();
    emitStartup('Core geometry engine ready', ready.status === 'ready' ? 'success' : 'warning', ready);

    const capabilitiesResponse = await fetch(`${backendInfo.backendUrl}/capabilities`);
    const capabilities = await capabilitiesResponse.json();
    fs.writeFileSync(path.join(getLogDir(), 'capabilities.json'), JSON.stringify(capabilities, null, 2));
    emitStartup('Open3D available', capabilities.open3d ? 'success' : 'error', { open3d: capabilities.open3d });
    if (!capabilities.triposr) emitStartup('TripoSR model unavailable', 'warning');
    if (!capabilities.sam) emitStartup('SAM model unavailable', 'warning');
    emitStartup('Application ready', 'success', { totalMs: Date.now() - startupStartedAt });
    return { ready: true, url: backendInfo.backendUrl, port, capabilities, startupEvents };
  } catch (err) {
    writeCrash(err, { phase: 'backend-startup' });
    electronLogger.error('backend startup failed', { message: err.message, stack: err.stack });
    emitStartup('Backend startup failed', 'error', { message: err.message });
    return { ready: false, url: backendInfo?.backendUrl || null, error: err.message, startupEvents };
  }
}

function diagnosticsPayload() {
  const pkg = packageInfo();
  return {
    appVersion: pkg.version,
    buildDate: process.env.PACKLAB_BUILD_DATE || null,
    gitCommit: process.env.PACKLAB_GIT_COMMIT || null,
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    windows: os.release(),
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    packaged: app.isPackaged,
    backendUrl: backendInfo?.backendUrl || null,
    backendPid: backendProcess?.pid || null,
    logDir: getLogDir(),
    startupEvents,
  };
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    startupStartedAt = Date.now();
    ensureLogDir();
    startupLogger = createLogger('startup.log', { appVersion: packageInfo().version });
    electronLogger = createLogger('electron.log', { appVersion: packageInfo().version });
    emitStartup('Electron process start', 'success', {
      packaged: app.isPackaged,
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      node: process.versions.node,
      windows: os.release(),
    });
    emitStartup('Main process initialization', 'success', { logDir: getLogDir() });

    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(permission === 'media');
    });

    createWindow();
    backendReadyPromise = new Promise((resolve) => {
      resolveBackendReady = resolve;
    });
    setTimeout(() => {
      bootBackend().then((result) => {
        if (resolveBackendReady) resolveBackendReady(result);
      });
    }, 500);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

ipcMain.handle('backend:get-url', () => backendInfo?.backendUrl || null);
ipcMain.handle('backend:wait-ready', async () => backendReadyPromise || { ready: false, error: 'Backend startup has not begun.' });
ipcMain.handle('diagnostics:get', () => diagnosticsPayload());
ipcMain.handle('diagnostics:open-logs', () => shell.openPath(getLogDir()));

ipcMain.handle('dialog:save-file', async (_event, { defaultName, buffer }) => {
  const safeDefaultName = path.basename(String(defaultName || 'packlab3d-export.bin'));
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: safeDefaultName,
  });
  if (canceled || !filePath) return { saved: false };
  fs.writeFileSync(filePath, Buffer.from(buffer));
  return { saved: true, filePath };
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (event) => {
  if (backendProcess && backendProcess.exitCode === null && !backendProcess.killed) {
    event.preventDefault();
    await stopBackend(backendProcess, electronLogger || console);
    backendProcess = null;
    app.quit();
  }
});
