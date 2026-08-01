import { mountMeasurementForm } from '../../frontend/electron/renderer/components/MeasurementForm.js';
import { mountLabelStyleSelector } from '../../frontend/electron/renderer/components/LabelStyleSelector.js';
import { mountLabelShapeSelector } from '../../frontend/electron/renderer/components/LabelShapeSelector.js';
import { mountMaterialSelector } from '../../frontend/electron/renderer/components/MaterialSelector.js';
import { mountFileUploader } from '../../frontend/electron/renderer/components/FileUploader.js';
import { createFakeI18n, createTestStore } from './helpers.js';

describe('MeasurementForm', () => {
  test('renders a select and 5 numeric fields', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const i18n = createFakeI18n();
    const store = createTestStore({ measurement: {} });
    mountMeasurementForm(document.getElementById('root'), { i18n, store });

    expect(document.querySelectorAll('#root select').length).toBe(1);
    expect(document.querySelectorAll('#root input[type="number"]').length).toBe(5);
  });

  test('typing in a field updates the store', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const i18n = createFakeI18n();
    const store = createTestStore({ measurement: { packagingType: 'bottle' } });
    mountMeasurementForm(document.getElementById('root'), { i18n, store });

    const widthInput = document.querySelectorAll('#root input[type="number"]')[0];
    widthInput.value = '42';
    widthInput.dispatchEvent(new Event('input'));

    expect(store.getState().measurement.widthMm).toBe('42');
  });

  test('shows a validation error when no dimension is provided', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const i18n = createFakeI18n();
    const store = createTestStore({ measurement: { packagingType: 'bottle' } });
    mountMeasurementForm(document.getElementById('root'), { i18n, store });

    const errors = [...document.querySelectorAll('.field-error')].map((el) => el.textContent);
    expect(errors.some((text) => text === i18n.t('common.requiredField'))).toBe(true);
  });

  test('re-renders with translated labels after language switch', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const i18n = createFakeI18n('en');
    const store = createTestStore({ measurement: {} });
    mountMeasurementForm(document.getElementById('root'), { i18n, store });

    expect(document.querySelector('#root label').textContent).toBe('Packaging Type');
    i18n.setLanguage('tr');
    expect(document.querySelector('#root label').textContent).toBe('Ambalaj Türü');
  });
});

describe('LabelStyleSelector', () => {
  test('renders all 5 untranslated brand style names', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const i18n = createFakeI18n();
    const store = createTestStore({ label: {} });
    mountLabelStyleSelector(document.getElementById('root'), { i18n, store });

    const names = [...document.querySelectorAll('.swatch span:last-child')].map((el) => el.textContent);
    expect(names).toEqual(['Minimal Modern', 'Premium Gold', 'Eco Green', 'Industrial Tech', 'Bold Colorful']);
  });

  test('names stay identical across languages (brand identifiers, never translated)', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const i18n = createFakeI18n('en');
    const store = createTestStore({ label: {} });
    mountLabelStyleSelector(document.getElementById('root'), { i18n, store });
    const before = [...document.querySelectorAll('.swatch span:last-child')].map((el) => el.textContent);

    i18n.setLanguage('sw');
    const after = [...document.querySelectorAll('.swatch span:last-child')].map((el) => el.textContent);
    expect(after).toEqual(before);
  });

  test('clicking a swatch updates the store and marks it selected', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const i18n = createFakeI18n();
    const store = createTestStore({ label: {} });
    mountLabelStyleSelector(document.getElementById('root'), { i18n, store });

    document.querySelectorAll('.swatch')[2].click(); // Eco Green
    expect(store.getState().label.style).toBe('eco_green');
    expect(document.querySelectorAll('.swatch')[2].className).toContain('selected');
  });
});

describe('LabelShapeSelector', () => {
  test('renders all 7 shapes (tasks.md 5 ∪ this-stage 5)', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const i18n = createFakeI18n();
    const store = createTestStore({ label: {} });
    mountLabelShapeSelector(document.getElementById('root'), { i18n, store });
    expect(document.querySelectorAll('.shape-btn').length).toBe(7);
  });

  test('clicking a shape button updates the store', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const i18n = createFakeI18n();
    const store = createTestStore({ label: {} });
    mountLabelShapeSelector(document.getElementById('root'), { i18n, store });

    document.querySelectorAll('.shape-btn')[2].click(); // circle
    expect(store.getState().label.shape).toBe('circle');
  });
});

describe('MaterialSelector', () => {
  test('renders the 5 untranslated material codes plus an auto option', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const i18n = createFakeI18n();
    const store = createTestStore({ label: {} });
    mountMaterialSelector(document.getElementById('root'), { i18n, store });

    const options = [...document.querySelectorAll('option')].map((o) => o.value);
    expect(options).toEqual(['', 'PET', 'PP', 'HDPE', 'LDPE', 'PE']);
  });

  test('selecting a material updates the store', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const i18n = createFakeI18n();
    const store = createTestStore({ label: {} });
    mountMaterialSelector(document.getElementById('root'), { i18n, store });

    const select = document.querySelector('select');
    select.value = 'HDPE';
    select.dispatchEvent(new Event('change'));
    expect(store.getState().label.material).toBe('HDPE');
  });
});

describe('FileUploader', () => {
  test('renders the initial i18n label', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const i18n = createFakeI18n();
    mountFileUploader(document.getElementById('root'), { i18n, labelKey: 'form.uploadPhoto' });
    expect(document.querySelector('.uploader').textContent).toBe('Upload Photo');
  });

  test('clicking the dropzone delegates to the hidden file input', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const i18n = createFakeI18n();
    mountFileUploader(document.getElementById('root'), { i18n, labelKey: 'form.uploadPhoto' });
    const input = document.querySelector('input[type="file"]');
    const clickSpy = jest.spyOn(input, 'click');
    document.querySelector('.uploader').click();
    expect(clickSpy).toHaveBeenCalled();
  });

  test('selecting a file calls onFile and updates the label text', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const i18n = createFakeI18n();
    const onFile = jest.fn();
    mountFileUploader(document.getElementById('root'), { i18n, labelKey: 'form.uploadPhoto', onFile });

    const input = document.querySelector('input[type="file"]');
    const file = new File(['data'], 'photo.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], writable: false });
    input.dispatchEvent(new Event('change'));

    expect(onFile).toHaveBeenCalledWith(file);
    expect(document.querySelector('.uploader').textContent).toBe('photo.png');
  });
});
