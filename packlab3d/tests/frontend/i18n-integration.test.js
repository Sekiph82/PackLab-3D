import { mountLanguageSwitcher } from '../../frontend/electron/renderer/components/LanguageSwitcher.js';
import { mountMeasurementForm } from '../../frontend/electron/renderer/components/MeasurementForm.js';
import { mountLabelShapeSelector } from '../../frontend/electron/renderer/components/LabelShapeSelector.js';
import { createFakeI18n, createTestStore } from './helpers.js';

test('switching language via LanguageSwitcher instantly updates every mounted component', () => {
  document.body.innerHTML = `
    <div id="switcher"></div>
    <div id="measurement"></div>
    <div id="shapes"></div>
  `;

  const i18n = createFakeI18n('en');
  const store = createTestStore({ measurement: {}, label: {} });

  mountLanguageSwitcher(document.getElementById('switcher'), { i18n });
  mountMeasurementForm(document.getElementById('measurement'), { i18n, store });
  mountLabelShapeSelector(document.getElementById('shapes'), { i18n, store });

  expect(document.querySelector('#measurement label').textContent).toBe('Packaging Type');
  expect(document.querySelectorAll('#shapes .shape-btn')[0].textContent).toBe('Rectangle');

  document.querySelector('#switcher button[data-lang="sw"]').click();

  expect(i18n.language).toBe('sw');
  expect(document.querySelector('#measurement label').textContent).toBe('Aina ya Ufungaji');
  expect(document.querySelectorAll('#shapes .shape-btn')[0].textContent).toBe('Mstatili');
  expect(document.querySelector('#switcher button.active').dataset.lang).toBe('sw');
});

test('static [data-i18n] document text updates via applyToDom on language change', () => {
  document.body.innerHTML = '<h1 data-i18n="nav.measurements"></h1>';
  const i18n = createFakeI18n('en');
  i18n.applyToDom(document);
  i18n.onChange(() => i18n.applyToDom(document));

  expect(document.querySelector('h1').textContent).toBe('Measurements');
  i18n.setLanguage('tr');
  expect(document.querySelector('h1').textContent).toBe('Ölçümler');
});
