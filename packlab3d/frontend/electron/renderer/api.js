function decodeApiMessage(headers) {
  const raw = headers.get('X-Api-Message');
  return raw ? decodeURIComponent(raw) : null;
}

async function parseJsonError(response) {
  let detail = response.statusText;
  let body = null;
  try {
    body = await response.clone().json();
    if (body && body.detail) detail = typeof body.detail === 'string' ? body.detail : body.detail.message || JSON.stringify(body.detail);
  } catch (err) {
    // keep status text
  }
  const error = new Error(detail);
  error.status = response.status;
  error.detail = body?.detail || body;
  return error;
}

async function postForm(baseUrl, path, formData, { timeoutMs } = {}) {
  const controller = timeoutMs ? new AbortController() : null;
  const timeout = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, { method: 'POST', body: formData, signal: controller?.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutError = new Error('Label application took too long and was cancelled.');
      timeoutError.code = 'LABEL_MAPPING_TIMEOUT';
      throw timeoutError;
    }
    throw err;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const data = await response.clone().json();
      if (data && data.detail) detail = typeof data.detail === 'string' ? data.detail : data.detail.message || JSON.stringify(data.detail);
    } catch (err) {
      // response body wasn't JSON — keep statusText
    }
    const error = new Error(detail);
    error.status = response.status;
    throw error;
  }
  return response;
}

export function createApiClient(baseUrl) {
  async function fileResult(path, formData, options = {}) {
    const res = await postForm(baseUrl, path, formData, options);
    return { arrayBuffer: await res.arrayBuffer(), message: decodeApiMessage(res.headers), headers: res.headers };
  }

  return {
    async createProject({ projectName = '', packageType = 'bottle' } = {}) {
      const res = await fetch(`${baseUrl}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName, packageType }),
      });
      if (!res.ok) throw await parseJsonError(res);
      return res.json();
    },

    async uploadProjectPhotos({ projectId, photos, viewTypes = [] }) {
      const fd = new FormData();
      photos.forEach((photo, index) => {
        fd.append('photos', photo.file, photo.file.name);
        fd.append('view_type', viewTypes[index] || photo.viewType || 'custom');
      });
      const res = await postForm(baseUrl, `/projects/${projectId}/photos`, fd);
      return res.json();
    },

    async updateProjectPhotos({ projectId, photos }) {
      const res = await fetch(`${baseUrl}/projects/${projectId}/photos`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photos }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
      return res.json();
    },

    async startPhotoAnalysis({ projectId }) {
      const res = await fetch(`${baseUrl}/projects/${projectId}/analyze-photos`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
      return res.json();
    },

    async startPhotoSegmentation({ projectId }) {
      const res = await fetch(`${baseUrl}/projects/${projectId}/segment-photos`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
      return res.json();
    },

    async startReconstruction({ projectId, measurements = {}, packageType = 'bottle', reconstructionMode = 'auto' }) {
      const res = await fetch(`${baseUrl}/projects/${projectId}/reconstruct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ measurements, packageType, reconstructionMode }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
      return res.json();
    },

    async getJob(jobId) {
      const res = await fetch(`${baseUrl}/jobs/${jobId}`);
      if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
      return res.json();
    },

    async cancelJob(jobId) {
      const res = await fetch(`${baseUrl}/jobs/${jobId}/cancel`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
      return res.json();
    },

    async getProjectResult(projectId) {
      const res = await fetch(`${baseUrl}/projects/${projectId}/result`);
      if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
      return res.json();
    },

    async getProjectReport(projectId) {
      const res = await fetch(`${baseUrl}/projects/${projectId}/report`);
      if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
      return res.json();
    },

    async getProjectAsset({ projectId, assetName }) {
      const res = await fetch(`${baseUrl}/projects/${projectId}/assets/${assetName}`);
      if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
      return { arrayBuffer: await res.arrayBuffer(), headers: res.headers };
    },

    async getEditableModel(projectId) {
      const res = await fetch(`${baseUrl}/projects/${projectId}/editable-model`);
      if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
      return res.json();
    },

    async updateEditableModel({ projectId, edits, expectedModelRevision = null, operationId = null, sourceEditor = null }) {
      const res = await fetch(`${baseUrl}/projects/${projectId}/editable-model`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...edits, expectedModelRevision, operationId, sourceEditor }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        const error = new Error(payload.detail?.message || payload.detail || res.statusText);
        error.status = res.status;
        error.detail = payload.detail;
        throw error;
      }
      return res.json();
    },

    async getEditorState(projectId) {
      const res = await fetch(`${baseUrl}/projects/${projectId}/editable-model/editor-state`);
      if (!res.ok) throw await parseJsonError(res);
      return res.json();
    },

    async updateEditorState({ projectId, editorState, expectedRevision = null }) {
      const res = await fetch(`${baseUrl}/projects/${projectId}/editable-model/editor-state`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision, editorState }),
      });
      if (!res.ok) throw await parseJsonError(res);
      return res.json();
    },

    async updateDrawingDocument({ projectId, patch }) {
      const res = await fetch(`${baseUrl}/projects/${projectId}/drawing-document`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw await parseJsonError(res);
      return res.json();
    },

    async updateLandmarks({ projectId, photoId, landmarks, expectedRevision = null }) {
      const res = await fetch(`${baseUrl}/projects/${projectId}/photos/${photoId}/landmarks`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoId, landmarks, expectedRevision }),
      });
      if (!res.ok) throw await parseJsonError(res);
      return res.json();
    },

    async updatePhotoMask({ projectId, photoId, width, height, checksum, maskData, expectedRevision = null }) {
      const res = await fetch(`${baseUrl}/projects/${projectId}/photos/${photoId}/mask`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ width, height, checksum, maskData, expectedRevision }),
      });
      if (!res.ok) throw await parseJsonError(res);
      return res.json();
    },

    async getPhotoGeometry({ projectId, photoId }) {
      const res = await fetch(`${baseUrl}/projects/${projectId}/photos/${photoId}/geometry`);
      if (!res.ok) throw await parseJsonError(res);
      return res.json();
    },

    async getPhotoContour({ projectId, photoId }) {
      const res = await fetch(`${baseUrl}/projects/${projectId}/photos/${photoId}/contour`);
      if (!res.ok) throw await parseJsonError(res);
      return res.json();
    },

    async updatePhotoContour({ projectId, photoId, expectedRevision = null, points, holes = [], reason = 'manual contour edit' }) {
      const res = await fetch(`${baseUrl}/projects/${projectId}/photos/${photoId}/contour`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision, points, holes, reason }),
      });
      if (!res.ok) throw await parseJsonError(res);
      return res.json();
    },

    async saveRecoverySnapshot({ projectId, state }) {
      const res = await fetch(`${baseUrl}/projects/${projectId}/recovery`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
      return res.json();
    },

    async restoreRecoverySnapshot({ projectId }) {
      const res = await fetch(`${baseUrl}/projects/${projectId}/recovery`);
      if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
      return res.json();
    },

    async discardRecoverySnapshot({ projectId }) {
      const res = await fetch(`${baseUrl}/projects/${projectId}/recovery`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
      return res.json();
    },

    async saveProjectVersion({ projectId, name, note = '' }) {
      const res = await fetch(`${baseUrl}/projects/${projectId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, note }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
      return res.json();
    },

    async compareProjectVersions({ projectId, leftVersionId, rightVersionId }) {
      const res = await fetch(`${baseUrl}/projects/${projectId}/versions/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leftVersionId, rightVersionId }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
      return res.json();
    },

    async restoreProjectVersion({ projectId, versionId }) {
      const res = await fetch(`${baseUrl}/projects/${projectId}/versions/${versionId}/restore`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
      return res.json();
    },

    async getCapabilities({ refresh = false } = {}) {
      const res = await fetch(`${baseUrl}/capabilities${refresh ? '?refresh=true' : ''}`);
      if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
      return res.json();
    },

    async scaleMesh({ file, dimensions = {}, uniform = false, language = 'en' }) {
      const fd = new FormData();
      fd.append('file', file);
      Object.entries(dimensions).forEach(([key, value]) => {
        if (value !== null && value !== undefined && value !== '') fd.append(key, value);
      });
      fd.append('uniform', uniform);
      fd.append('language', language);
      return fileResult('/scale-mesh', fd);
    },

    async cleanupMesh({ file, upAxis = 'y', language = 'en' }) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('up_axis', upAxis);
      fd.append('language', language);
      return fileResult('/cleanup-mesh', fd);
    },

    async applyWallThickness({ file, packagingType, material, thicknessMm, language = 'en' }) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('packaging_type', packagingType);
      if (material) fd.append('material', material);
      if (thicknessMm !== undefined && thicknessMm !== null) fd.append('thickness_mm', thicknessMm);
      fd.append('language', language);
      return fileResult('/apply-wall-thickness', fd);
    },

    async generate2d({ file, material, wallThicknessMm, language = 'en' }) {
      const fd = new FormData();
      fd.append('file', file);
      if (material) fd.append('material', material);
      if (wallThicknessMm !== undefined && wallThicknessMm !== null) {
        fd.append('wall_thickness_mm', wallThicknessMm);
      }
      fd.append('language', language);
      return fileResult('/generate-2d', fd);
    },

    async generateLabel({ style, shape, widthMm, heightMm, language = 'en', content = {}, logo }) {
      const fd = new FormData();
      fd.append('style', style);
      fd.append('shape', shape);
      fd.append('width_mm', widthMm);
      fd.append('height_mm', heightMm);
      fd.append('language', language);
      Object.entries(content).forEach(([key, value]) => {
        if (value !== null && value !== undefined && value !== '') fd.append(key, value);
      });
      if (logo) fd.append('logo', logo);
      return fileResult('/generate-label', fd);
    },

    async applyLabelTo3d({ file, packagingType, labelPngBlob, uvMode, textureResolution = 1024, language = 'en', timeoutMs = 45000 }) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('packaging_type', packagingType);
      if (labelPngBlob) fd.append('label_png', labelPngBlob, 'label.png');
      if (uvMode) fd.append('uv_mode', uvMode);
      fd.append('texture_resolution', textureResolution);
      fd.append('language', language);
      return fileResult('/apply-label-to-3d', fd, { timeoutMs });
    },

    async setLanguage(language) {
      const res = await fetch(`${baseUrl}/set-language`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language }),
      });
      return res.json();
    },
  };
}
