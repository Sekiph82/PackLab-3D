import fs from 'fs';
import path from 'path';
import { mountLanguageSwitcher } from '../../frontend/electron/renderer/components/LanguageSwitcher.js';
import { mountLabelStyleSelector } from '../../frontend/electron/renderer/components/LabelStyleSelector.js';
import { mountLabelShapeSelector } from '../../frontend/electron/renderer/components/LabelShapeSelector.js';
import { createFakeI18n, createTestStore } from './helpers.js';

const INDEX_HTML_PATH = path.join(__dirname, '..', '..', 'frontend', 'electron', 'renderer', 'index.html');

function loadRealIndexHtml() {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf-8');
  const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/);
  return bodyMatch[1];
}

test('splash screen markup matches snapshot (from the real index.html)', () => {
  document.body.innerHTML = loadRealIndexHtml();
  const splash = document.getElementById('splash');
  expect(splash.outerHTML).toMatchSnapshot();
});

test('4-panel app grid markup matches snapshot (from the real index.html)', () => {
  document.body.innerHTML = loadRealIndexHtml();
  const grid = document.querySelector('.app-grid');
  expect(grid.outerHTML).toMatchSnapshot();
});

test('app header (brand + language switcher mount point) matches snapshot', () => {
  document.body.innerHTML = loadRealIndexHtml();
  const header = document.querySelector('.app-header');
  expect(header.outerHTML).toMatchSnapshot();
});

test('LanguageSwitcher rendered markup matches snapshot', () => {
  document.body.innerHTML = '<div id="root"></div>';
  mountLanguageSwitcher(document.getElementById('root'), { i18n: createFakeI18n('en') });
  expect(document.getElementById('root').innerHTML).toMatchSnapshot();
});

test('LabelStyleSelector rendered markup matches snapshot', () => {
  document.body.innerHTML = '<div id="root"></div>';
  mountLabelStyleSelector(document.getElementById('root'), {
    i18n: createFakeI18n('en'),
    store: createTestStore({ label: { style: 'eco_green' } }),
  });
  expect(document.getElementById('root').innerHTML).toMatchSnapshot();
});

test('LabelShapeSelector rendered markup matches snapshot', () => {
  document.body.innerHTML = '<div id="root"></div>';
  mountLabelShapeSelector(document.getElementById('root'), {
    i18n: createFakeI18n('en'),
    store: createTestStore({ label: { shape: 'oval' } }),
  });
  expect(document.getElementById('root').innerHTML).toMatchSnapshot();
});
