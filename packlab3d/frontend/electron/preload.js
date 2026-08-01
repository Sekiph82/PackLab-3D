const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

const I18N_DIR = path.join(__dirname, '..', 'i18n');
const SUPPORTED_LANGUAGES = ['en', 'tr', 'sw'];

// Real logo pack contents (verified — no upload.png/camera.png/icon-set/GLB
// exist in this folder, only these 7 raster logo marks). Mapped to semantic
// names so the rest of the app doesn't need to know the on-disk filenames.
const DEV_LOGO_PACK_DIR = path.join(__dirname, '..', '..', '..', 'PackLab 3D logo pack');
const PACKAGED_LOGO_PACK_DIR = path.join(process.resourcesPath || '', 'logo-pack');
const LOGO_PACK_DIR = fs.existsSync(PACKAGED_LOGO_PACK_DIR) ? PACKAGED_LOGO_PACK_DIR : DEV_LOGO_PACK_DIR;
const LOGO_FILES = {
  main: 'main logo.png',
  mainLarge: 'main logo 512 512 px.png',
  icon512: '512x512 px.png',
  icon512Dark: '512x512 px dark mode.png',
  icon32: '32x32 px.png',
  icon32Dark: '32x32 px dark mode.png',
  icon16: '16x16 px.png',
};

function loadLanguageData(lang) {
  const target = SUPPORTED_LANGUAGES.includes(lang) ? lang : 'en';
  const filePath = path.join(I18N_DIR, `${target}.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function loadLogosAsDataUrls() {
  const logos = {};
  for (const [key, filename] of Object.entries(LOGO_FILES)) {
    try {
      const buffer = fs.readFileSync(path.join(LOGO_PACK_DIR, filename));
      logos[key] = `data:image/png;base64,${buffer.toString('base64')}`;
    } catch (err) {
      logos[key] = null; // missing file -> caller falls back gracefully
    }
  }
  return logos;
}

let backendProgressHandler = null;
ipcRenderer.on('backend:progress', (_event, percent) => {
  if (backendProgressHandler) backendProgressHandler(percent);
});

let startupStageHandler = null;
ipcRenderer.on('startup:stage', (_event, stage) => {
  if (startupStageHandler) startupStageHandler(stage);
});

contextBridge.exposeInMainWorld('packlab', {
  backend: {
    getUrl: () => ipcRenderer.invoke('backend:get-url'),
    waitReady: () => ipcRenderer.invoke('backend:wait-ready'),
  },
  diagnostics: {
    get: () => ipcRenderer.invoke('diagnostics:get'),
    openLogs: () => ipcRenderer.invoke('diagnostics:open-logs'),
  },
  files: {
    save: (defaultName, arrayBuffer) =>
      ipcRenderer.invoke('dialog:save-file', { defaultName, buffer: arrayBuffer }),
  },
  i18n: {
    supportedLanguages: SUPPORTED_LANGUAGES,
    load: (lang) => loadLanguageData(lang),
  },
  // Real logo pack assets, pre-loaded as data URLs (avoids CSP/file:// issues
  // reading outside the renderer's own directory). Any key may be `null` if
  // that particular file didn't exist on disk — callers must handle that.
  logos: loadLogosAsDataUrls(),
  // contextBridge exposes a frozen object — the renderer can't do
  // `window.packlab.onBackendProgress = fn` (Stage 10 draft assumed it
  // could). This setter is the working equivalent.
  setBackendProgressHandler: (fn) => {
    backendProgressHandler = fn;
  },
  setStartupStageHandler: (fn) => {
    startupStageHandler = fn;
  },
});
