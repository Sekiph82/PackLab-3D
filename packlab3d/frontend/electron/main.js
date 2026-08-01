const { app, BrowserWindow, ipcMain, dialog, nativeImage, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createLogger, ensureLogDir, getLogDir } = require('./logger');
const { findAvailablePort, startBackend, stopBackend, waitForEndpoint } = require('./backend-process');

if (process.env.PACKLAB_REMOTE_DEBUGGING_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', String(process.env.PACKLAB_REMOTE_DEBUGGING_PORT));
}

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
let isQuitting = false;

const STARTUP_PROGRESS = {
  'Electron process start': 15,
  'Main process initialization': 18,
  'Desktop interface started': 20,
  'Main window creation': 24,
  'Renderer DOM ready': 30,
  'Three.js viewer ready': 34,
  'Backend executable lookup': 40,
  'Backend process spawn call started': 43,
  'Backend process spawn call returned': 48,
  'Backend process spawn event': 52,
  'First backend output': 58,
  'Health live available': 68,
  'Core backend ready': 78,
  'Capabilities loaded': 88,
  'Open3D available': 92,
  'Application ready': 100,
  'Backend startup failed': 100,
};

function progressFor(stage, state) {
  const progress = STARTUP_PROGRESS[stage];
  if (state === 'error' && stage !== 'Backend startup failed') return undefined;
  return progress;
}

function capabilityAvailable(capability) {
  if (typeof capability === 'boolean') return capability;
  return Boolean(capability?.available);
}

function packageInfo() {
  const pkgPath = path.join(__dirname, '..', 'package.json');
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch (err) {
    return { version: 'unknown' };
  }
}

function emitStartup(stage, state, detail = {}) {
  const progress = detail.progress ?? progressFor(stage, state);
  const event = {
    timestamp: new Date().toISOString(),
    elapsedMs: Date.now() - startupStartedAt,
    stage,
    state,
    ...(progress !== undefined ? { progress } : {}),
    ...detail,
  };
  startupEvents.push(event);
  startupLogger?.info('startup stage', event);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('startup:stage', event);
    if (progress !== undefined) mainWindow.webContents.send('backend:progress', Math.max(0, Math.min(100, Math.round(progress))));
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
    emitStartup('Backend process spawn call started', 'running', { port });
    backendInfo = startBackend({
      app,
      projectRoot: PROJECT_ROOT,
      port,
      logDir: getLogDir(),
      logger: electronLogger,
    });
    backendProcess = backendInfo.child;
    emitStartup('Backend process spawn call returned', 'success', {
      pid: backendInfo.backendPid(),
      launcherPid: backendProcess.pid,
      port,
      backendUrl: backendInfo.backendUrl,
      executable: backendInfo.exePath || backendInfo.command,
      spawnCallDurationMs: Number(backendInfo.spawnCallDurationMs.toFixed(2)),
    });
    backendProcess.once('spawn', () => {
      emitStartup('Backend process spawn event', 'success', {
        pid: backendInfo.backendPid(),
        launcherPid: backendProcess.pid,
        processSpawnEventDelayMs: Number((Date.now() - startupStartedAt).toFixed(2)),
      });
    });

    let sawOutput = false;
    backendProcess.stdout?.once('data', () => {
      sawOutput = true;
      emitStartup('First backend output', 'success', { firstStdoutDelayMs: Date.now() - startupStartedAt });
    });
    backendProcess.stderr?.once('data', () => {
      if (!sawOutput) emitStartup('First backend output', 'warning', { stream: 'stderr', firstStderrDelayMs: Date.now() - startupStartedAt });
    });

    const live = await waitForEndpoint(`${backendInfo.backendUrl}/health/live`, {
      timeoutMs: STARTUP_TIMEOUT_MS,
      onAttempt: (_attempt, elapsedMs) => {
        if (elapsedMs > 1000 && elapsedMs < 1400) emitStartup('Health live available', 'running');
      },
    });
    if (!live.ok) throw new Error(`Backend health timeout after ${live.elapsedMs} ms`);
    emitStartup('Health live available', 'success', { healthLiveDelayMs: live.elapsedMs, attempts: live.attempts });

    const readyResponse = await fetch(`${backendInfo.backendUrl}/health/ready`);
    const ready = await readyResponse.json();
    emitStartup('Core geometry engine ready', ready.status === 'ready' ? 'success' : 'warning', ready);

    const capabilitiesResponse = await fetch(`${backendInfo.backendUrl}/capabilities`);
    const capabilities = await capabilitiesResponse.json();
    fs.writeFileSync(path.join(getLogDir(), 'capabilities.json'), JSON.stringify(capabilities, null, 2));
    emitStartup('Capabilities loaded', 'success', { capabilityCount: Object.keys(capabilities).length });
    emitStartup('Open3D available', capabilityAvailable(capabilities.open3d) ? 'success' : 'error', { open3d: capabilities.open3d });
    emitStartup('PackLab native reconstruction available', capabilityAvailable(capabilities.native_reconstruction) ? 'success' : 'error', { nativeReconstruction: capabilities.native_reconstruction });
    if (!capabilityAvailable(capabilities.sam)) emitStartup('SAM model unavailable', 'warning');
    emitStartup('Application ready', 'success', { totalMs: Date.now() - startupStartedAt });
    return { ready: true, mode: 'CORE_ONLY', url: backendInfo.backendUrl, port, backendPid: backendInfo.backendPid(), capabilities, startupEvents };
  } catch (err) {
    writeCrash(err, { phase: 'backend-startup' });
    electronLogger.error('backend startup failed', { message: err.message, stack: err.stack });
    emitStartup('Backend startup failed', 'error', { message: err.message });
    return { ready: false, mode: 'VIEWER_ONLY', url: backendInfo?.backendUrl || null, error: err.message, startupEvents };
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
    backendPid: backendInfo?.backendPid?.() || backendProcess?.pid || null,
    diagnosticsMode: process.argv.includes('--diagnostics') || process.env.PACKLAB_DIAGNOSTICS === '1',
    logDir: getLogDir(),
    startupEvents,
  };
}

function restartBackend() {
  backendReadyPromise = new Promise((resolve) => {
    resolveBackendReady = resolve;
  });
  bootBackend().then((result) => {
    if (resolveBackendReady) resolveBackendReady(result);
  });
  return backendReadyPromise;
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
ipcMain.handle('backend:retry', async () => restartBackend());
ipcMain.handle('diagnostics:get', () => diagnosticsPayload());
ipcMain.handle('diagnostics:open-logs', () => shell.openPath(getLogDir()));
ipcMain.handle('app:quit', async () => {
  app.quit();
  return { quitting: true };
});

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
  if (backendProcess && (backendInfo?.backendPid?.() || (backendProcess.exitCode === null && !backendProcess.killed))) {
    if (isQuitting) return;
    event.preventDefault();
    isQuitting = true;
    await stopBackend(backendProcess, electronLogger || console);
    backendProcess = null;
    app.exit(0);
  }
});
