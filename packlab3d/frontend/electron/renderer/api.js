function decodeApiMessage(headers) {
  const raw = headers.get('X-Api-Message');
  return raw ? decodeURIComponent(raw) : null;
}

async function postForm(baseUrl, path, formData) {
  const response = await fetch(`${baseUrl}${path}`, { method: 'POST', body: formData });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const data = await response.clone().json();
      if (data && data.detail) detail = data.detail;
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
  async function fileResult(path, formData) {
    const res = await postForm(baseUrl, path, formData);
    return { arrayBuffer: await res.arrayBuffer(), message: decodeApiMessage(res.headers), headers: res.headers };
  }

  return {
    async generateMesh({ file, backend = 'triposr', language = 'en' }) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('backend', backend);
      fd.append('language', language);
      return fileResult('/generate-mesh', fd);
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

    async applyLabelTo3d({ file, packagingType, labelPngBlob, uvMode, textureResolution = 1024, language = 'en' }) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('packaging_type', packagingType);
      if (labelPngBlob) fd.append('label_png', labelPngBlob, 'label.png');
      if (uvMode) fd.append('uv_mode', uvMode);
      fd.append('texture_resolution', textureResolution);
      fd.append('language', language);
      return fileResult('/apply-label-to-3d', fd);
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
