import { createI18n, resolveKey } from './i18n.js';

const FIXTURES = {
  en: { splash: { slogan: 'Precision Packaging Design.' }, nav: { measurements: 'Measurements' } },
  tr: { splash: { slogan: 'Hassas Ambalaj Tasarımı' }, nav: { measurements: 'Ölçümler' } },
  sw: { splash: { slogan: 'Ubunifu wa Ufungaji wa Usahihi' }, nav: { measurements: 'Vipimo' } },
};

function mockPacklabApi() {
  return {
    i18n: {
      supportedLanguages: ['en', 'tr', 'sw'],
      load: (lang) => FIXTURES[lang],
    },
  };
}

test('resolveKey walks dotted paths', () => {
  expect(resolveKey(FIXTURES.en, 'splash.slogan')).toBe('Precision Packaging Design.');
  expect(resolveKey(FIXTURES.en, 'nope.nope')).toBeUndefined();
});

test('t() returns the current language string', () => {
  const i18n = createI18n(mockPacklabApi(), 'en');
  expect(i18n.t('splash.slogan')).toBe('Precision Packaging Design.');
});

test('t() falls back to key path when missing', () => {
  const i18n = createI18n(mockPacklabApi(), 'en');
  expect(i18n.t('missing.key')).toBe('missing.key');
});

test('t() falls back to provided default when missing', () => {
  const i18n = createI18n(mockPacklabApi(), 'en');
  expect(i18n.t('missing.key', 'default text')).toBe('default text');
});

test('setLanguage switches active language and notifies listeners', () => {
  const i18n = createI18n(mockPacklabApi(), 'en');
  const seen = [];
  i18n.onChange((lang) => seen.push(lang));

  i18n.setLanguage('tr');
  expect(i18n.language).toBe('tr');
  expect(i18n.t('splash.slogan')).toBe('Hassas Ambalaj Tasarımı');
  expect(seen).toEqual(['tr']);
});

test('setLanguage ignores unsupported languages', () => {
  const i18n = createI18n(mockPacklabApi(), 'en');
  i18n.setLanguage('fr');
  expect(i18n.language).toBe('en');
});

test('applyToDom updates all [data-i18n] elements', () => {
  document.body.innerHTML = '<div data-i18n="nav.measurements"></div>';
  const i18n = createI18n(mockPacklabApi(), 'sw');
  i18n.applyToDom(document);
  expect(document.querySelector('[data-i18n]').textContent).toBe('Vipimo');
});
