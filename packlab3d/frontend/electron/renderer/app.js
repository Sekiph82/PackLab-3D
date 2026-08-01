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
import { mountMultiPhotoUploader } from './components/MultiPhotoUploader.js';
import { mountCameraCapture } from './components/CameraCapture.js';
import { mountThreeJsViewer } from './components/ThreeJSViewer.js';
import { mountExportPanel } from './components/ExportPanel.js';

async function main() {
  const splash = document.getElementById('splash');
  const appRoot = document.getElementById('app');
  const loadingText = document.getElementById('loading-text');
  const loadingProgress = document.getElementById('loading-progress');
  const loadingStage = document.getElementById('loading-stage');
  const startupStages = document.getElementById('startup-stages');
  const failureActions = document.getElementById('startup-failure-actions');
  const retryBackendButton = document.getElementById('retry-backend-button');

  const stageRows = new Map();
  let visibleProgress = 0;
  let backendFailed = false;
  let mounted = false;

  function setProgress(percent, label = '') {
    const next = Math.max(0, Math.min(100, Number(percent) || 0));
    visibleProgress = Math.max(visibleProgress, next);
    loadingText.textContent = `Loading... ${Math.round(visibleProgress)}%`;
    loadingProgress.style.width = `${visibleProgress}%`;
    if (label && loadingStage) loadingStage.textContent = label;
  }

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
    if (stage.progress !== undefined && stage.state !== 'error') setProgress(stage.progress, stage.stage);
    startupStages.scrollTop = startupStages.scrollHeight;
  }

  const i18n = createI18n(window.packlab, 'en');
  i18n.applyToDom(document);
  i18n.onChange(() => i18n.applyToDom(document));

  const transparentLogo = window.packlab.logos.icon512 || window.packlab.logos.mainLarge || window.packlab.logos.main || '';
  document.getElementById('header-logo').src = window.packlab.logos.icon32 || transparentLogo;
  document.getElementById('splash-logo').src = transparentLogo;

  startSplashAnimation();

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
    if (window.packlab.config?.diagnosticsMode) {
      setTimeout(async () => {
        await refreshDiagnostics();
        diagnosticsDialog.showModal();
      }, 250);
    }
  }

  function mountApplication(url) {
    if (mounted) return;
    mounted = true;
    const api = url ? createApiClient(url) : null;
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
    const statusEl = document.getElementById('pipeline-status');

    window.addEventListener('packlab:viewer-ready', () => {
      console.info('[startup] Three.js viewer ready');
      renderStartupStage({ stage: 'Three.js viewer ready', state: 'success', progress: 95 });
    });
    const viewer = mountThreeJsViewer(document.getElementById('threejs-viewer'), { i18n });

    const photoUploader = api
      ? mountMultiPhotoUploader(document.getElementById('photo-uploader'), {
          i18n,
          store,
          api,
          viewer,
          setStatus: (text) => {
            statusEl.textContent = text;
          },
        })
      : null;

    mountCameraCapture(document.getElementById('camera-capture'), {
      onCapture: (file) => photoUploader?.addFiles([file]),
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

    if (api) {
      mountExportPanel(document.getElementById('export-panel'), {
        i18n,
        store,
        api,
        viewer,
        setStatus: (text) => {
          statusEl.textContent = text;
        },
      });
    } else {
      statusEl.textContent = 'Backend unavailable. Viewer and diagnostics remain available.';
      document.getElementById('export-panel').textContent = 'Backend-dependent exports are disabled until the backend starts.';
    }

    appRoot.classList.remove('app--hidden');
  }

  setupDiagnostics();
  retryBackendButton?.addEventListener('click', async () => {
    backendFailed = false;
    failureActions.hidden = true;
    renderStartupStage({ stage: 'Backend retry requested', state: 'running' });
    const retry = await window.packlab.backend.retry();
    if (!retry.ready) {
      backendFailed = true;
      loadingText.textContent = 'Ready with limited features';
      failureActions.hidden = false;
      renderStartupStage({ stage: 'Backend retry failed', state: 'error', message: retry.error || 'See logs.' });
      return;
    }
    window.location.reload();
  });

  window.packlab.setStartupStageHandler(renderStartupStage);
  window.packlab.setBackendProgressHandler((percent) => {
    if (backendFailed) return;
    setProgress(percent);
    if (percent >= 100) {
      const holdMs = Number(window.packlab.config?.splashHoldMs || 0);
      setTimeout(() => splash.classList.add('fade-out'), Math.max(500, holdMs));
    }
  });

  const { ready, url, error } = await window.packlab.backend.waitReady();
  if (!ready) {
    backendFailed = true;
    setProgress(100, 'Ready with limited features');
    loadingText.textContent = 'Ready with limited features';
    failureActions.hidden = false;
    renderStartupStage({ stage: 'Startup failed', state: 'error', message: error || 'See logs.' });
    mountApplication(null);
    loadingText.textContent = 'Ready with limited features';
    if (loadingStage) loadingStage.textContent = 'Backend unavailable. Viewer-only mode is active.';
    setTimeout(() => splash.classList.add('fade-out'), 900);
    return;
  }

  mountApplication(url);
  setProgress(100, 'Application ready');
}

main().catch((err) => {
  console.error(err);
  const status = document.getElementById('loading-text');
  if (status) status.textContent = `Startup error: ${err.message}`;
});
