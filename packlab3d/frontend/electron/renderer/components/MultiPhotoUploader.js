import { formatFileSize } from './FileUploader.js';

export const MAX_PHOTOS = 10;
export const MAX_FILE_SIZE = 25 * 1024 * 1024;
export const MAX_TOTAL_SIZE = 150 * 1024 * 1024;
export const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const VIEW_TYPES = [
  ['front', 'Front'],
  ['back', 'Back'],
  ['left', 'Left'],
  ['right', 'Right'],
  ['top', 'Top'],
  ['bottom', 'Bottom'],
  ['front_left', 'Front-Left'],
  ['front_right', 'Front-Right'],
  ['back_left', 'Back-Left'],
  ['back_right', 'Back-Right'],
  ['custom', 'Custom'],
];

function photoId() {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function viewForIndex(index) {
  return VIEW_TYPES[Math.min(index, VIEW_TYPES.length - 1)][0];
}

function readImageMeta(file, url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ width: null, height: null });
    image.src = url;
  });
}

export function validatePhotoSelection(existingPhotos, files) {
  const selected = Array.from(files || []);
  if (selected.length === 0) return { ok: false, error: 'Select at least one photo.' };
  if (existingPhotos.length + selected.length > MAX_PHOTOS) {
    return { ok: false, error: 'PackLab 3D accepts at most 10 photos. Reduce the selection and try again.' };
  }
  let total = existingPhotos.reduce((sum, photo) => sum + photo.file.size, 0);
  for (const file of selected) {
    if (!SUPPORTED_TYPES.includes(file.type)) {
      return { ok: false, error: `Unsupported file type: ${file.type || 'unknown'}. Use JPEG, PNG, or WebP.` };
    }
    if (file.size > MAX_FILE_SIZE) {
      return { ok: false, error: `${file.name} exceeds the 25 MB per-photo limit.` };
    }
    total += file.size;
  }
  if (total > MAX_TOTAL_SIZE) {
    return { ok: false, error: 'Combined photo size exceeds 150 MB.' };
  }
  return { ok: true, files: selected };
}

export function mountMultiPhotoUploader(container, { i18n, store, api, viewer, setStatus }) {
  container.innerHTML = '';

  function t(key, fallback) {
    return i18n.t(key, fallback);
  }

  const state = {
    projectId: null,
    photos: [],
    uploaded: false,
    activeJobId: null,
    report: null,
    reconstructionMode: 'auto',
    capabilities: null,
  };

  const root = document.createElement('div');
  root.className = 'multi-photo';

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp';
  input.multiple = true;
  input.className = 'multi-photo__input';
  input.hidden = true;

  const actions = document.createElement('div');
  actions.className = 'multi-photo__actions';
  const addButton = button('photos.add', 'Add Photos', () => input.click());
  const workspaceButton = button('photos.openWorkspace', 'Open Photo Workspace', () => grid.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  const clearButton = button('photos.removeAll', 'Remove All', removeAll);
  const autoAssignButton = button('photos.autoAssignViews', 'Auto-Assign Views', autoAssignViews);
  const analyzeButton = button('photos.reviewQuality', 'Review Photo Quality', () => runAnalysis().catch(showError));
  const reconstructButton = button('reconstruction.createUnifiedDesign', 'Create Unified Design', () => runFullReconstruction().catch(showError));
  actions.append(addButton, workspaceButton, clearButton, autoAssignButton, analyzeButton, reconstructButton);

  const modeField = document.createElement('label');
  modeField.className = 'multi-photo__mode';
  const modeLabel = document.createElement('span');
  modeLabel.textContent = t('reconstruction.mode', 'Reconstruction Mode');
  const modeSelect = document.createElement('select');
  [
    ['auto', t('reconstruction.modes.auto', 'Auto')],
    ['multiview_parametric', t('reconstruction.modes.multiViewParametric', 'Multi-View Parametric')],
    ['basic_parametric', t('reconstruction.modes.basicParametric', 'Basic Parametric')],
    ['experimental_ai_reference', t('reconstruction.modes.experimentalAiReference', 'Experimental AI Reference Mesh')],
  ].forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    modeSelect.appendChild(option);
  });
  modeSelect.value = state.reconstructionMode;
  modeSelect.addEventListener('change', () => {
    state.reconstructionMode = modeSelect.value;
    syncStore();
  });
  modeField.append(modeLabel, modeSelect);

  const counter = document.createElement('div');
  counter.className = 'multi-photo__counter';

  const error = document.createElement('div');
  error.className = 'uploader-error';

  const grid = document.createElement('div');
  grid.className = 'multi-photo__grid';

  const progress = document.createElement('div');
  progress.className = 'multi-photo__progress';
  progress.innerHTML = '<div class="multi-photo__progress-label">No reconstruction job running.</div><div class="multi-photo__progress-bar"><div></div></div>';

  const providerStatus = document.createElement('div');
  providerStatus.className = 'multi-photo__provider-status';

  const report = document.createElement('div');
  report.className = 'multi-photo__report';

  input.addEventListener('change', () => addFiles(input.files));
  root.addEventListener('dragover', (event) => {
    event.preventDefault();
    root.classList.add('dragover');
  });
  root.addEventListener('dragleave', () => root.classList.remove('dragover'));
  root.addEventListener('drop', (event) => {
    event.preventDefault();
    root.classList.remove('dragover');
    addFiles(event.dataTransfer.files);
  });

  root.append(input, actions, modeField, counter, error, providerStatus, grid, progress, report);
  container.appendChild(root);
  render();

  api.getCapabilities?.()
    .then((capabilities) => {
      state.capabilities = capabilities;
      render();
    })
    .catch(() => {
      state.capabilities = null;
      render();
    });

  function button(key, fallback, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.i18nKey = key;
    btn.dataset.i18nFallback = fallback;
    btn.textContent = t(key, fallback);
    btn.addEventListener('click', onClick);
    return btn;
  }

  function showError(err) {
    const message = err instanceof Error ? err.message : String(err);
    error.textContent = message;
    setStatus(message);
  }

  function clearError() {
    error.textContent = '';
  }

  async function addFiles(files) {
    clearError();
    const validation = validatePhotoSelection(state.photos, files);
    input.value = '';
    if (!validation.ok) {
      showError(validation.error);
      return;
    }
    for (const file of validation.files) {
      const url = URL.createObjectURL(file);
      const photo = {
        id: photoId(),
        file,
        url,
        originalName: file.name,
        size: file.size,
        width: null,
        height: null,
        viewType: viewForIndex(state.photos.length),
        included: true,
        order: state.photos.length,
        rotation: 0,
        uploadedId: null,
        quality: { status: 'not_analyzed' },
        segmentation: { status: 'not_processed' },
      };
      state.photos.push(photo);
      readImageMeta(file, url).then((meta) => {
        photo.width = meta.width;
        photo.height = meta.height;
        render();
      });
    }
    state.uploaded = false;
    syncStore();
    render();
  }

  function removeAll() {
    state.photos.forEach((photo) => URL.revokeObjectURL(photo.url));
    state.photos = [];
    state.projectId = null;
    state.uploaded = false;
    state.report = null;
    syncStore();
    render();
  }

  function removePhoto(photoIdValue) {
    const index = state.photos.findIndex((photo) => photo.id === photoIdValue);
    if (index < 0) return;
    URL.revokeObjectURL(state.photos[index].url);
    state.photos.splice(index, 1);
    state.photos.forEach((photo, order) => {
      photo.order = order;
    });
    state.uploaded = false;
    syncStore();
    render();
  }

  function movePhoto(photoIdValue, delta) {
    const index = state.photos.findIndex((photo) => photo.id === photoIdValue);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= state.photos.length) return;
    const [photo] = state.photos.splice(index, 1);
    state.photos.splice(target, 0, photo);
    state.photos.forEach((item, order) => {
      item.order = order;
    });
    state.uploaded = false;
    syncStore();
    render();
  }

  function autoAssignViews() {
    state.photos.forEach((photo, index) => {
      photo.viewType = viewForIndex(index);
    });
    state.uploaded = false;
    syncStore();
    render();
  }

  function rotatePhoto(photo, delta) {
    photo.rotation = (photo.rotation + delta + 360) % 360;
    render();
  }

  function syncStore(extra = {}) {
    const current = store.getState();
    const included = state.photos.filter((photo) => photo.included);
    store.setState({
      ...extra,
      photo: included[0]?.file || null,
      photoSet: {
        projectId: state.projectId,
        photos: state.photos.map((photo) => ({
          id: photo.uploadedId || photo.id,
          originalName: photo.originalName,
          viewType: photo.viewType,
          order: photo.order,
          included: photo.included,
          quality: photo.quality,
          segmentation: photo.segmentation,
        })),
        report: state.report,
        reconstructionMode: state.reconstructionMode,
      },
      pipeline: { ...(current.pipeline || {}), ...(extra.pipeline || {}) },
    });
  }

  async function ensureUploaded() {
    if (state.photos.length === 0) throw new Error(t('photos.errors.uploadAtLeastOne', 'Upload at least one photo.'));
    if (!state.photos.some((photo) => photo.included)) throw new Error(t('photos.errors.includeAtLeastOne', 'Include at least one photo.'));
    if (!state.projectId) {
      const measurement = store.getState().measurement || {};
      const project = await api.createProject({ packageType: measurement.packagingType || 'bottle' });
      state.projectId = project.id;
    }
    if (!state.uploaded) {
      setStatus(t('photos.status.uploading', 'Uploading photo set...'));
      const result = await api.uploadProjectPhotos({
        projectId: state.projectId,
        photos: state.photos,
        viewTypes: state.photos.map((photo) => photo.viewType),
      });
      result.project.photos.forEach((serverPhoto, index) => {
        if (state.photos[index]) {
          state.photos[index].uploadedId = serverPhoto.id;
          state.photos[index].quality = serverPhoto.quality;
          state.photos[index].segmentation = serverPhoto.segmentation;
        }
      });
      state.uploaded = true;
    }
    await api.updateProjectPhotos({
      projectId: state.projectId,
      photos: state.photos.map((photo, order) => ({
        photoId: photo.uploadedId,
        viewType: photo.viewType,
        included: photo.included,
        order,
      })),
    });
    syncStore();
  }

  async function waitForJob(job, label) {
    state.activeJobId = job.id;
    let latest = job;
    while (!['succeeded', 'failed', 'cancelled'].includes(latest.state)) {
      renderProgress(latest, label);
      await new Promise((resolve) => setTimeout(resolve, 300));
      latest = await api.getJob(job.id);
    }
    renderProgress(latest, label);
    if (latest.state !== 'succeeded') throw new Error(`${label} ${latest.state}: ${latest.error || latest.message}`);
    return latest;
  }

  async function runAnalysis() {
    clearError();
    await ensureUploaded();
    const job = await api.startPhotoAnalysis({ projectId: state.projectId });
    const done = await waitForJob(job, t('photos.qualityAnalysis', 'Photo quality analysis'));
    mergeServerPhotos(done.result?.photos || []);
    setStatus(t('photos.status.qualityComplete', 'Photo quality analysis complete.'));
    render();
  }

  async function runSegmentation() {
    await ensureUploaded();
    const job = await api.startPhotoSegmentation({ projectId: state.projectId });
    const done = await waitForJob(job, t('photos.segmentation', 'Photo segmentation'));
    mergeServerPhotos(done.result?.photos || []);
    render();
  }

  async function runFullReconstruction() {
    clearError();
    await runAnalysis();
    await runSegmentation();
    const measurement = store.getState().measurement || {};
    const job = await api.startReconstruction({
      projectId: state.projectId,
      packageType: measurement.packagingType || 'bottle',
      reconstructionMode: state.reconstructionMode,
      measurements: {
        heightMm: measurement.heightMm,
        widthMm: measurement.widthMm,
        depthMm: measurement.depthMm,
        diameterMm: measurement.diameterMm,
        volumeMl: measurement.volumeMl,
      },
    });
    const done = await waitForJob(job, t('reconstruction.unified', 'Unified reconstruction'));
    state.report = done.result?.report || null;
    const referenceMesh = await api.getProjectAsset({ projectId: state.projectId, assetName: 'referenceMesh' });
    const cleanMesh = await api.getProjectAsset({ projectId: state.projectId, assetName: 'cleanMesh' });
    const glb = await api.getProjectAsset({ projectId: state.projectId, assetName: 'finalMesh' });
    const drawing = await api.getProjectAsset({ projectId: state.projectId, assetName: 'drawingPackage' });
    if (viewer) await viewer.loadGlbArrayBuffer(glb.arrayBuffer);
    syncStore({
      pipeline: {
        generated: referenceMesh.arrayBuffer,
        cleaned: cleanMesh.arrayBuffer,
        glb: glb.arrayBuffer,
        drawingZip: drawing.arrayBuffer,
        reconstructionReport: state.report,
      },
    });
    setStatus(`${t('reconstruction.fallbackSuccess', 'Unified design generated using parametric fallback.')}\n${reconstructionSummary(state.report)}`);
    render();
  }

  function mergeServerPhotos(serverPhotos) {
    serverPhotos.forEach((serverPhoto) => {
      const local = state.photos.find((photo) => photo.uploadedId === serverPhoto.id);
      if (!local) return;
      local.quality = serverPhoto.quality || local.quality;
      local.segmentation = serverPhoto.segmentation || local.segmentation;
    });
    syncStore();
  }

  function renderProgress(job, label) {
    const pct = Math.max(0, Math.min(100, Number(job.overallProgress) || 0));
    progress.querySelector('.multi-photo__progress-label').textContent = `${label}: ${job.message} (${pct}%)`;
    progress.querySelector('.multi-photo__progress-bar div').style.width = `${pct}%`;
  }

  function reconstructionSummary(item) {
    if (!item) return t('reconstruction.complete', 'Unified reconstruction complete.');
    const fallbackUsed = item.trueMultiViewReconstruction === false || /fallback|parametric/i.test(item.method || '');
    return [
      t('reconstruction.complete', 'Unified reconstruction complete.'),
      `${t('reconstruction.providerUsed', 'Provider used')}: ${providerLabel(item.method)}`,
      `${t('reconstruction.aiModelInstalled', 'AI model installed')}: ${aiInstalled() ? t('common.yes', 'Yes') : t('common.no', 'No')}`,
      `${t('reconstruction.fallbackUsed', 'Fallback used')}: ${fallbackUsed ? t('common.yes', 'Yes') : t('common.no', 'No')}`,
      `${t('reconstruction.method', 'Method')}: ${item.method}`,
      `${t('reconstruction.photosUsed', 'Photos used')}: ${(item.photosUsed || []).length}`,
      `${t('reconstruction.photosExcluded', 'Photos excluded')}: ${(item.photosExcluded || []).length}`,
      `${t('reconstruction.confidence', 'Confidence')}: ${item.confidence}`,
      ...(item.limitations || []),
    ].join('\n');
  }

  function render() {
    counter.textContent = `${t('photos.counterLabel', 'Photos')}: ${state.photos.length} / ${MAX_PHOTOS}`;
    renderProviderStatus();
    grid.innerHTML = '';
    state.photos.forEach((photo, index) => grid.appendChild(renderCard(photo, index)));
    if (state.report) {
      report.textContent = reconstructionSummary(state.report);
    } else {
      report.textContent = '';
    }
  }

  function renderProviderStatus() {
    const torch = state.capabilities?.torch;
    const triposr = state.capabilities?.triposr;
    providerStatus.textContent = [
      t('reconstruction.aiReconstruction', 'AI Reconstruction'),
      `TripoSR: ${triposr?.available ? t('common.installed', 'Installed') : t('common.notInstalled', 'Not installed')}`,
      `Torch: ${torch?.available ? t('common.installed', 'Installed') : t('common.notInstalled', 'Not installed')}`,
      `${t('reconstruction.modelWeights', 'Model weights')}: ${t('common.notInstalled', 'Not installed')}`,
      `CUDA: ${state.capabilities?.cuda?.available ? t('common.available', 'Available') : t('common.unavailable', 'Unavailable')}`,
      `${t('reconstruction.standardUnifiedDesign', 'Standard unified design')}: ${t('common.available', 'Available')}`,
      `${t('reconstruction.parametricFallback', 'Multi-view parametric fallback')}: ${t('common.available', 'Available')}`,
    ].join(' | ');
  }

  function aiInstalled() {
    return Boolean(state.capabilities?.triposr?.available);
  }

  function providerLabel(method) {
    if (/parametric-multiview|multiview.*parametric/i.test(method || '')) return t('reconstruction.modes.multiViewParametric', 'Multi-View Parametric');
    if (/single-view|basic/i.test(method || '')) return t('reconstruction.modes.basicParametric', 'Basic Parametric');
    return method || t('reconstruction.modes.auto', 'Auto');
  }

  function renderCard(photo, index) {
    const card = document.createElement('div');
    card.className = `photo-card photo-card--${qualityClass(photo.quality?.status)}`;
    card.draggable = true;
    card.addEventListener('dragstart', (event) => event.dataTransfer.setData('text/plain', photo.id));
    card.addEventListener('dragover', (event) => event.preventDefault());
    card.addEventListener('drop', (event) => {
      event.preventDefault();
      const draggedId = event.dataTransfer.getData('text/plain');
      const fromIndex = state.photos.findIndex((item) => item.id === draggedId);
      if (fromIndex < 0 || fromIndex === index) return;
      const [dragged] = state.photos.splice(fromIndex, 1);
      state.photos.splice(index, 0, dragged);
      state.photos.forEach((item, order) => {
        item.order = order;
      });
      state.uploaded = false;
      syncStore();
      render();
    });

    const image = document.createElement('img');
    image.src = photo.url;
    image.alt = photo.originalName;
    image.style.transform = `rotate(${photo.rotation}deg)`;

    const meta = document.createElement('div');
    meta.className = 'photo-card__meta';
    meta.innerHTML = `<strong>${photo.originalName}</strong><span>${photo.width || '?'}x${photo.height || '?'} px | ${formatFileSize(photo.size)}</span>`;

    const view = document.createElement('select');
    VIEW_TYPES.forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = photo.viewType === value;
      view.appendChild(option);
    });
    view.addEventListener('change', () => {
      photo.viewType = view.value;
      state.uploaded = false;
      syncStore();
    });

    const include = document.createElement('label');
    include.className = 'photo-card__include';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = photo.included;
    checkbox.addEventListener('change', () => {
      photo.included = checkbox.checked;
      state.uploaded = false;
      syncStore();
      render();
    });
    include.append(checkbox, document.createTextNode(t('photos.include', 'Include')));

    const status = document.createElement('div');
    status.className = 'photo-card__status';
    status.textContent = `${t('photos.quality', 'Quality')}: ${photo.quality?.status || 'not_analyzed'} | ${t('photos.mask', 'Mask')}: ${photo.segmentation?.status || 'not_processed'}`;

    const controls = document.createElement('div');
    controls.className = 'photo-card__controls';
    controls.append(
      button('common.up', 'Up', () => movePhoto(photo.id, -1)),
      button('common.down', 'Down', () => movePhoto(photo.id, 1)),
      button('photos.rotateLeft', 'Rotate L', () => rotatePhoto(photo, -90)),
      button('photos.rotateRight', 'Rotate R', () => rotatePhoto(photo, 90)),
      button('common.remove', 'Remove', () => removePhoto(photo.id))
    );

    card.append(image, meta, view, include, status, controls);
    return card;
  }

  function qualityClass(status) {
    if (status === 'excellent' || status === 'good') return 'good';
    if (status === 'poor') return 'poor';
    if (status === 'usable_with_warnings') return 'warning';
    return 'pending';
  }

  return {
    addFiles,
    getState: () => state,
    destroy() {
      state.photos.forEach((photo) => URL.revokeObjectURL(photo.url));
    },
  };
}
