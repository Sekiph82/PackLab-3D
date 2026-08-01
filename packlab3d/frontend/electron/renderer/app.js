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
  const startupStages = document.getElementById('startup-stages');

  const stageRows = new Map();
  function renderStartupStage(stage) {
    if (!startupStages || !stage?.stage) return;
    let row = stageRows.get(stage.stage);
    if (!row) {
      row = document.createElement('div');
      row.className = 'startup-stage';
      row.innerHTML = '<span class="startup-stage__state"></span><span class="startup-stage__label"></span>';
      startupStages.appendChild(row);
      stageRows.set(stage.stage, row);
    }
    row.className = `startup-stage startup-stage--${stage.state}`;
    row.querySelector('.startup-stage__state').textContent = stage.state;
    const suffix = stage.elapsedMs !== undefined ? ` (${stage.elapsedMs} ms)` : '';
    const detail = stage.message ? `: ${stage.message}` : '';
    row.querySelector('.startup-stage__label').textContent = `${stage.stage}${detail}${suffix}`;
  }

  const i18n = createI18n(window.packlab, 'en');
  i18n.applyToDom(document);
  i18n.onChange(() => i18n.applyToDom(document));

  document.getElementById('header-logo').src = window.packlab.logos.icon32 || window.packlab.logos.main || '';

  startSplashAnimation({ logoDataUrl: window.packlab.logos.mainLarge || window.packlab.logos.main });

  function setupDiagnostics() {
    const diagnosticsDialog = document.getElementById('diagnostics-dialog');
    const diagnosticsContent = document.getElementById('diagnostics-content');
    const diagnosticsButton = document.getElementById('diagnostics-button');
    const diagnosticsClose = document.getElementById('diagnostics-close');
    const diagnosticsCopy = document.getElementById('diagnostics-copy');
    const diagnosticsOpenLogs = document.getElementById('diagnostics-open-logs');

    async function refreshDiagnostics() {
      const diagnostics = await window.packlab.diagnostics.get();
      diagnosticsContent.textContent = JSON.stringify(diagnostics, null, 2);
      return diagnostics;
    }

    diagnosticsButton?.addEventListener('click', async () => {
      await refreshDiagnostics();
      diagnosticsDialog.showModal();
    });
    diagnosticsClose?.addEventListener('click', () => diagnosticsDialog.close());
    diagnosticsCopy?.addEventListener('click', async () => {
      const diagnostics = await refreshDiagnostics();
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
    });
    diagnosticsOpenLogs?.addEventListener('click', () => window.packlab.diagnostics.openLogs());
  }

  setupDiagnostics();

  let backendFailed = false;
  window.packlab.setStartupStageHandler(renderStartupStage);
  window.packlab.setBackendProgressHandler((percent) => {
    if (backendFailed) return;
    loadingText.textContent = `Loading… ${percent}%`;
    loadingProgress.style.width = `${percent}%`;
    if (percent >= 100) {
      setTimeout(() => splash.classList.add('fade-out'), 500);
    }
  });

  const { ready, url, error } = await window.packlab.backend.waitReady();
  if (!ready) {
    backendFailed = true;
    loadingText.textContent = 'Backend failed to start. Open Diagnostics for details.';
    renderStartupStage({ stage: 'Startup failed', state: 'error', message: error || 'See logs.' });
    appRoot.classList.remove('app--hidden');
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

  window.addEventListener('packlab:viewer-ready', () => {
    console.info('[startup] Three.js viewer ready');
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
