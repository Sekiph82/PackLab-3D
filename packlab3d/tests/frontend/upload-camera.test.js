import { formatFileSize, mountFileUploader } from '../../frontend/electron/renderer/components/FileUploader.js';
import { mountCameraCapture } from '../../frontend/electron/renderer/components/CameraCapture.js';
import { createFakeI18n } from './helpers.js';

describe('formatFileSize', () => {
  test('formats bytes', () => {
    expect(formatFileSize(500)).toBe('500 B');
  });

  test('formats kilobytes', () => {
    expect(formatFileSize(2048)).toBe('2.0 KB');
  });

  test('formats megabytes', () => {
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('FileUploader validation', () => {
  test('rejects a non-image file with a visible error', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const i18n = createFakeI18n();
    const onFile = jest.fn();
    mountFileUploader(document.getElementById('root'), { i18n, onFile });

    const input = document.querySelector('input[type="file"]');
    const file = new File(['data'], 'notes.txt', { type: 'text/plain' });
    Object.defineProperty(input, 'files', { value: [file], writable: false });
    input.dispatchEvent(new Event('change'));

    expect(onFile).not.toHaveBeenCalled();
    expect(document.querySelector('.uploader-error').textContent).toContain('Unsupported file type');
    expect(document.querySelector('.uploader').className).toContain('invalid');
  });

  test('accepts an image file and clears any previous error', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const i18n = createFakeI18n();
    const onFile = jest.fn();
    mountFileUploader(document.getElementById('root'), { i18n, onFile });

    const input = document.querySelector('input[type="file"]');
    const badFile = new File(['data'], 'notes.txt', { type: 'text/plain' });
    Object.defineProperty(input, 'files', { value: [badFile], writable: false, configurable: true });
    input.dispatchEvent(new Event('change'));
    expect(document.querySelector('.uploader-error').textContent).not.toBe('');

    const goodFile = new File(['data'], 'photo.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [goodFile], writable: false, configurable: true });
    input.dispatchEvent(new Event('change'));

    expect(onFile).toHaveBeenCalledWith(goodFile);
    expect(document.querySelector('.uploader-error').textContent).toBe('');
    expect(document.querySelector('.uploader').className).not.toContain('invalid');
  });

  test('setFile() (used by camera capture) routes through the same validation/onFile path', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const i18n = createFakeI18n();
    const onFile = jest.fn();
    const uploader = mountFileUploader(document.getElementById('root'), { i18n, onFile });

    const captured = new File(['data'], 'capture-123.png', { type: 'image/png' });
    uploader.setFile(captured);

    expect(onFile).toHaveBeenCalledWith(captured);
  });
});

describe('CameraCapture', () => {
  test('renders nothing when no webcam API is available (jsdom has none)', () => {
    document.body.innerHTML = '<div id="root"></div>';
    mountCameraCapture(document.getElementById('root'), { onCapture: jest.fn() });
    expect(document.getElementById('root').innerHTML).toBe('');
  });
});
