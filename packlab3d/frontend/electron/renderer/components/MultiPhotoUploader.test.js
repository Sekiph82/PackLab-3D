import { mountMultiPhotoUploader, validatePhotoSelection } from './MultiPhotoUploader.js';

function file(name, type = 'image/png', size = 10) {
  return new File([new Uint8Array(size)], name, { type });
}

function fakeI18n() {
  return { t: (_key, fallback) => fallback || _key };
}

function fakeStore() {
  let state = { measurement: { packagingType: 'box', heightMm: 120 }, pipeline: {} };
  return {
    getState: () => state,
    setState: (patch) => {
      state = { ...state, ...patch };
    },
  };
}

function fakeApi() {
  const calls = [];
  return {
    calls,
    createProject: jest.fn(async () => ({ id: 'project-1' })),
    uploadProjectPhotos: jest.fn(async ({ photos }) => ({
      project: {
        photos: photos.map((photo, index) => ({
          id: `photo-${index + 1}`,
          quality: { status: 'not_analyzed' },
          segmentation: { status: 'not_processed' },
        })),
      },
    })),
    updateProjectPhotos: jest.fn(async (payload) => {
      calls.push(['updateProjectPhotos', payload.photos]);
      return { ok: true };
    }),
    startPhotoAnalysis: jest.fn(async () => ({ id: 'job-analysis', state: 'running', overallProgress: 5, message: 'Analyzing' })),
    startPhotoSegmentation: jest.fn(async () => ({ id: 'job-segment', state: 'running', overallProgress: 5, message: 'Segmenting' })),
    startReconstruction: jest.fn(async () => ({ id: 'job-reconstruct', state: 'running', overallProgress: 5, message: 'Reconstructing' })),
    getJob: jest.fn(async (jobId) => ({
      id: jobId,
      state: 'succeeded',
      overallProgress: 100,
      message: 'Done',
      result: jobId === 'job-reconstruct'
        ? {
            report: {
              method: 'parametric-multiview-silhouette-fit',
              photosUsed: ['photo-1', 'photo-2'],
              photosExcluded: [],
              confidence: 'medium',
              limitations: ['fallback'],
            },
          }
        : {
            photos: [
              { id: 'photo-1', quality: { status: 'good' }, segmentation: { status: 'automatic_mask_ready' } },
              { id: 'photo-2', quality: { status: 'good' }, segmentation: { status: 'automatic_mask_ready' } },
            ],
          },
    })),
    getProjectAsset: jest.fn(async () => ({ arrayBuffer: new ArrayBuffer(8), headers: new Headers() })),
  };
}

beforeEach(() => {
  global.URL.createObjectURL = jest.fn((item) => `blob:${item.name}`);
  global.URL.revokeObjectURL = jest.fn();
});

test('validatePhotoSelection accepts one and ten supported images', () => {
  expect(validatePhotoSelection([], [file('one.png')]).ok).toBe(true);
  expect(validatePhotoSelection([], Array.from({ length: 10 }, (_, index) => file(`${index}.png`))).ok).toBe(true);
});

test('validatePhotoSelection rejects eleven images and unsupported types', () => {
  expect(validatePhotoSelection([], Array.from({ length: 11 }, (_, index) => file(`${index}.png`))).ok).toBe(false);
  expect(validatePhotoSelection([], [file('bad.gif', 'image/gif')]).ok).toBe(false);
});

test('component renders cards, allows include state, view assignment, reordering, and removal', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  const uploader = mountMultiPhotoUploader(document.getElementById('root'), {
    i18n: fakeI18n(),
    store: fakeStore(),
    api: fakeApi(),
    viewer: { loadGlbArrayBuffer: jest.fn() },
    setStatus: jest.fn(),
  });

  await uploader.addFiles([file('front.png'), file('side.png')]);
  expect(document.querySelectorAll('.photo-card')).toHaveLength(2);
  expect(document.querySelector('.multi-photo__counter').textContent).toBe('2 / 10 photos uploaded');

  const firstSelect = document.querySelector('.photo-card select');
  firstSelect.value = 'right';
  firstSelect.dispatchEvent(new Event('change'));
  expect(uploader.getState().photos[0].viewType).toBe('right');

  const include = document.querySelector('.photo-card__include input');
  include.checked = false;
  include.dispatchEvent(new Event('change'));
  expect(uploader.getState().photos[0].included).toBe(false);

  [...document.querySelectorAll('.photo-card__controls button')].find((btn) => btn.textContent === 'Down').click();
  expect(uploader.getState().photos[0].originalName).toBe('side.png');

  [...document.querySelectorAll('.photo-card__controls button')].find((btn) => btn.textContent === 'Remove').click();
  expect(document.querySelectorAll('.photo-card')).toHaveLength(1);
  expect(URL.revokeObjectURL).toHaveBeenCalled();
});

test('component runs one unified reconstruction job and loads one final GLB', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  const api = fakeApi();
  const viewer = { loadGlbArrayBuffer: jest.fn() };
  const status = jest.fn();
  const uploader = mountMultiPhotoUploader(document.getElementById('root'), {
    i18n: fakeI18n(),
    store: fakeStore(),
    api,
    viewer,
    setStatus: status,
  });
  await uploader.addFiles([file('front.png'), file('left.png')]);
  document.querySelector('.multi-photo__actions button:last-child').click();
  await new Promise((resolve) => setTimeout(resolve, 1200));

  expect(api.uploadProjectPhotos).toHaveBeenCalledTimes(1);
  expect(api.startReconstruction).toHaveBeenCalledTimes(1);
  expect(viewer.loadGlbArrayBuffer).toHaveBeenCalledTimes(1);
  expect(status).toHaveBeenLastCalledWith(expect.stringContaining('parametric-multiview-silhouette-fit'));
});

test('destroy revokes object URLs', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  const uploader = mountMultiPhotoUploader(document.getElementById('root'), {
    i18n: fakeI18n(),
    store: fakeStore(),
    api: fakeApi(),
    viewer: null,
    setStatus: jest.fn(),
  });
  await uploader.addFiles([file('front.png'), file('left.png')]);
  uploader.destroy();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
});
