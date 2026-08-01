import { mountLanguageSwitcher } from './LanguageSwitcher.js';

function fakeI18n(initialLang = 'en') {
  let lang = initialLang;
  const listeners = new Set();
  const names = { en: 'English', tr: 'Türkçe', sw: 'Kiswahili' };
  return {
    supportedLanguages: ['en', 'tr', 'sw'],
    get language() {
      return lang;
    },
    t: (key) => names[key.split('.')[1]] || key,
    setLanguage: (newLang) => {
      lang = newLang;
      listeners.forEach((fn) => fn(newLang));
    },
    onChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

test('renders one button per supported language', () => {
  document.body.innerHTML = '<div id="switcher"></div>';
  const i18n = fakeI18n();
  mountLanguageSwitcher(document.getElementById('switcher'), { i18n });
  const buttons = document.querySelectorAll('#switcher button');
  expect(buttons.length).toBe(3);
  expect([...buttons].map((b) => b.dataset.lang)).toEqual(['en', 'tr', 'sw']);
});

test('marks the active language button', () => {
  document.body.innerHTML = '<div id="switcher"></div>';
  const i18n = fakeI18n('tr');
  mountLanguageSwitcher(document.getElementById('switcher'), { i18n });
  const active = document.querySelector('#switcher button.active');
  expect(active.dataset.lang).toBe('tr');
});

test('clicking a button calls i18n.setLanguage and re-renders as active', () => {
  document.body.innerHTML = '<div id="switcher"></div>';
  const i18n = fakeI18n('en');
  mountLanguageSwitcher(document.getElementById('switcher'), { i18n });

  const swButton = document.querySelector('#switcher button[data-lang="sw"]');
  swButton.click();

  expect(i18n.language).toBe('sw');
  const active = document.querySelector('#switcher button.active');
  expect(active.dataset.lang).toBe('sw');
});
