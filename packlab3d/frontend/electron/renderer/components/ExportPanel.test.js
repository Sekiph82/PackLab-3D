import { mountExportPanel } from './ExportPanel.js';

function fakeI18n() {
  return {
    language: 'en',
    t: (_key, fallback) => fallback || _key,
    onChange: () => () => {},
  };
}

function fakeStore(initial = {}) {
  let state = { measurement: {}, label: { style: 'minimal_modern', shape: 'rectangle' }, pipeline: {}, ...initial };
  return {
    getState: () => state,
    setState: (patch) => {
      state = { ...state, ...patch };
    },
  };
}

function fakeApi() {
  return {
    generateMesh: jest.fn(),
    scaleMesh: jest.fn(async () => ({ arrayBuffer: new ArrayBuffer(8), message: 'scaled' })),
    cleanupMesh: jest.fn(async () => ({ arrayBuffer: new ArrayBuffer(8), message: 'cleaned' })),
    applyWallThickness: jest.fn(async () => ({ arrayBuffer: new ArrayBuffer(8), message: 'walled' })),
    generate2d: jest.fn(async () => ({ arrayBuffer: new ArrayBuffer(8), message: 'drawing' })),
    generateLabel: jest.fn(async () => ({ arrayBuffer: new ArrayBuffer(8), message: 'label' })),
    applyLabelTo3d: jest.fn(async () => ({ arrayBuffer: new ArrayBuffer(8), message: 'labeled' })),
  };
}

test('export panel does not expose the legacy generate-mesh primary action', () => {
  document.body.innerHTML = '<div id="root"></div>';
  const api = fakeApi();
  mountExportPanel(document.getElementById('root'), {
    i18n: fakeI18n(),
    store: fakeStore({ photo: new File([new Uint8Array(4)], 'photo.png', { type: 'image/png' }) }),
    api,
    viewer: { loadGlbArrayBuffer: jest.fn() },
    setStatus: jest.fn(),
  });

  const labels = [...document.querySelectorAll('button')].map((button) => button.textContent);
  expect(labels).not.toContain('Generate');
  expect(api.generateMesh).not.toHaveBeenCalled();
});

test('export panel tells users to create a unified design before mesh operations', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  const setStatus = jest.fn();
  const api = fakeApi();
  mountExportPanel(document.getElementById('root'), {
    i18n: fakeI18n(),
    store: fakeStore(),
    api,
    viewer: { loadGlbArrayBuffer: jest.fn() },
    setStatus,
  });

  document.querySelector('button').click();
  await Promise.resolve();

  expect(setStatus).toHaveBeenLastCalledWith('scale-mesh FAILED: Create a unified design from the photo set first.');
  expect(api.generateMesh).not.toHaveBeenCalled();
});

