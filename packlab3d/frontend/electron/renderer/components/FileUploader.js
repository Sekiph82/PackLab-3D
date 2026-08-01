export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readImageDimensions(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: null, height: null });
    img.src = url;
  });
}

export function mountFileUploader(
  container,
  { i18n, labelKey = 'form.uploadPhoto', accept = 'image/*', onFile }
) {
  container.innerHTML = '';
  const dropzone = document.createElement('div');
  dropzone.className = 'uploader';
  dropzone.textContent = i18n.t(labelKey);

  const errorEl = document.createElement('div');
  errorEl.className = 'uploader-error';

  const previewEl = document.createElement('div');
  previewEl.className = 'uploader-preview';
  previewEl.style.display = 'none';

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.style.display = 'none';

  function showError(message) {
    errorEl.textContent = message;
    dropzone.classList.add('invalid');
  }

  function clearError() {
    errorEl.textContent = '';
    dropzone.classList.remove('invalid');
  }

  function showPreview(file) {
    // URL.createObjectURL doesn't exist in jsdom (unit test environment) —
    // thumbnail preview is a decorative enhancement, so degrade gracefully
    // rather than let its absence break the core onFile contract.
    if (typeof URL.createObjectURL !== 'function') return;
    const url = URL.createObjectURL(file);
    previewEl.innerHTML = '';
    const thumb = document.createElement('img');
    thumb.src = url;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = `${file.name}<br/>${formatFileSize(file.size)}`;
    previewEl.append(thumb, meta);
    previewEl.style.display = 'flex';

    // Fire-and-forget: resolution is a nice-to-have, must not block/gate
    // onFile() — jsdom (unit tests) never fires Image load events for blob
    // URLs at all, so this promise may simply never settle there.
    readImageDimensions(url).then(({ width, height }) => {
      if (width) meta.innerHTML += ` &middot; ${width}&times;${height}px`;
    });
  }

  function handleFiles(files) {
    if (!files || files.length === 0) return;
    const file = files[0];

    if (!file.type.startsWith('image/')) {
      showError(`Unsupported file type: ${file.type || 'unknown'}. Please select an image.`);
      previewEl.style.display = 'none';
      return;
    }
    clearError();
    dropzone.textContent = file.name;
    showPreview(file);

    if (onFile) onFile(file);
  }

  dropzone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => handleFiles(input.files));

  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('dragover');
    handleFiles(event.dataTransfer.files);
  });

  container.append(dropzone, errorEl, previewEl, input);

  const stopI18n = i18n.onChange(() => {
    if (!input.files || input.files.length === 0) dropzone.textContent = i18n.t(labelKey);
  });

  return {
    setFile: (file) => handleFiles([file]),
    destroy() {
      stopI18n();
    },
  };
}
