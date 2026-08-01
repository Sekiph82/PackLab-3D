import { createStore } from './state.js';
import { createI18n } from './i18n.js';
import { createApiClient } from './api.js';
import { startSplashAnimation } from './splash.js';
import { mountLanguageSwitcher } from './components/LanguageSwitcher.js';
import { mountMeasurementForm } from './components/MeasurementForm.js';
import { mountLabelStyleSelector } from './components/LabelStyleSelector.js';
import { mountLabelShapeSelector } from './components/LabelShapeSelector.js';
import { mountMaterialSelector } from './components/MaterialSelector.js';
import { mountFileUploader } from './components/FileUploader.js';
import { mountCameraCapture } from './components/CameraCapture.js';
import { mountThreeJsViewer } from './components/ThreeJSViewer.js';
import { mountExportPanel } from './components/ExportPanel.js';

async function main() {
  const splash = document.getElementById('splash');
  const appRoot = document.getElementById('app');
  const loadingText = document.getElementById('loading-text');
  const loadingProgress = document.getElementById('loading-progress');

  const i18n = createI18n(window.packlab, 'en');
  i18n.applyToDom(document);
  i18n.onChange(() => i18n.applyToDom(document));

  document.getElementById('header-logo').src = window.packlab.logos.icon32 || window.packlab.logos.main || '';

  startSplashAnimation({ logoDataUrl: window.packlab.logos.mainLarge || window.packlab.logos.main });

  let backendFailed = false;
  window.packlab.setBackendProgressHandler((percent) => {
    if (backendFailed) return;
    loadingText.textContent = `Loading… ${percent}%`;
    loadingProgress.style.width = `${percent}%`;
    if (percent >= 100) {
      setTimeout(() => splash.classList.add('fade-out'), 500);
    }
  });

  const { ready, url } = await window.packlab.backend.waitReady();
  if (!ready) {
    backendFailed = true;
    loadingText.textContent = 'Backend failed to start.';
    return;
  }

  const api = createApiClient(url);
  const store = createStore({
    measurement: { packagingType: 'bottle' },
    label: { style: 'minimal_modern', shape: 'rectangle' },
    photo: null,
    pipeline: {},
  });

  mountLanguageSwitcher(document.getElementById('language-switcher'), { i18n });
  mountMeasurementForm(document.getElementById('measurement-form'), { i18n, store });
  mountLabelStyleSelector(document.getElementById('label-style-selector'), { i18n, store });
  mountLabelShapeSelector(document.getElementById('label-shape-selector'), { i18n, store });
  mountMaterialSelector(document.getElementById('material-selector'), { i18n, store });

  const photoUploader = mountFileUploader(document.getElementById('photo-uploader'), {
    i18n,
    labelKey: 'form.uploadPhoto',
    accept: 'image/*',
    onFile: (file) => store.setState({ photo: file }),
  });

  mountCameraCapture(document.getElementById('camera-capture'), {
    onCapture: (file) => photoUploader.setFile(file), // routes through the same uploader (preview + onFile)
  });

  mountFileUploader(document.getElementById('logo-uploader'), {
    i18n,
    labelKey: 'label.content.logo',
    accept: 'image/*',
    onFile: (file) => {
      const current = store.getState().label || {};
      store.setState({ label: { ...current, logoFile: file } });
    },
  });

  const viewer = mountThreeJsViewer(document.getElementById('threejs-viewer'), { i18n });

  const statusEl = document.getElementById('pipeline-status');
  mountExportPanel(document.getElementById('export-panel'), {
    i18n,
    store,
    api,
    viewer,
    setStatus: (text) => {
      statusEl.textContent = text;
    },
  });

  appRoot.classList.remove('app--hidden');
}

main().catch((err) => {
  console.error(err);
  const status = document.getElementById('loading-text');
  if (status) status.textContent = `Startup error: ${err.message}`;
});
