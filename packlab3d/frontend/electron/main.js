const { app, BrowserWindow, ipcMain, dialog, nativeImage, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const BACKEND_HOST = '127.0.0.1';
const BACKEND_PORT = Number(process.env.PACKLAB_BACKEND_PORT) || 8000;
const BACKEND_URL = `http://${BACKEND_HOST}:${BACKEND_PORT}`;
const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');
const LOGO_PACK_DIR = path.join(PROJECT_ROOT, 'PackLab 3D logo pack');
const WINDOW_ICON_PATH = path.join(LOGO_PACK_DIR, '512x512 px.png');

let backendProcess = null;
let mainWindow = null;

function startBackend() {
  if (app.isPackaged) {
    const exePath = path.join(process.resourcesPath, 'backend', 'PackLab3DBackend.exe');
    backendProcess = spawn(exePath, [], { cwd: path.dirname(exePath) });
  } else {
    backendProcess = spawn(
      'python',
      ['-m', 'uvicorn', 'packlab3d.backend.api.main:app', '--host', BACKEND_HOST, '--port', String(BACKEND_PORT)],
      { cwd: PROJECT_ROOT }
    );
  }

  backendProcess.stdout?.on('data', (data) => console.log(`[backend] ${data}`));
  backendProcess.stderr?.on('data', (data) => console.error(`[backend] ${data}`));
  backendProcess.on('error', (err) => console.error('[backend] failed to start:', err));
  backendProcess.on('exit', (code) => console.log(`[backend] exited with code ${code}`));
}

function sendProgress(percent) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('backend:progress', Math.min(100, Math.round(percent)));
  }
}

async function waitForBackend(maxAttempts = 40, delayMs = 300) {
  // Progress is tied to real polling attempts, not a fixed fake step
  // sequence — it reflects how long the backend is actually taking to come up.
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    sendProgress((attempt / maxAttempts) * 95); // reserve the last 5% for the success confirmation below
    try {
      const response = await fetch(`${BACKEND_URL}/`);
      if (response.ok) {
        sendProgress(100);
        return true;
      }
    } catch (err) {
      // backend not ready yet — keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#0A0A0A',
    icon: fs.existsSync(WINDOW_ICON_PATH) ? nativeImage.createFromPath(WINDOW_ICON_PATH) : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Electron >=20 sandboxes preload scripts by default, which blocks
      // require('fs')/require('path') there entirely (confirmed via E2E run:
      // "Unable to load preload script... Error: module not found: fs").
      // Preload itself still only exposes the narrow window.packlab bridge to
      // the (unsandboxed-Node, contextIsolation-protected) renderer — the
      // renderer's own privilege level is unchanged by this setting.
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('backend:get-url', () => BACKEND_URL);

ipcMain.handle('backend:wait-ready', async () => {
  const ready = await waitForBackend();
  return { ready, url: BACKEND_URL };
});

ipcMain.handle('dialog:save-file', async (_event, { defaultName, buffer }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
  });
  if (canceled || !filePath) return { saved: false };
  fs.writeFileSync(filePath, Buffer.from(buffer));
  return { saved: true, filePath };
});

app.whenReady().then(() => {
  // Electron denies getUserMedia (camera capture) by default without an
  // explicit handler — this app is fully self-contained/offline, so auto-grant.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });

  startBackend();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (backendProcess) backendProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (backendProcess) backendProcess.kill();
});
