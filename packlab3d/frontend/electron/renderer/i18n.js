export function resolveKey(data, keyPath) {
  const keys = keyPath.split('.');
  let node = data;
  for (const key of keys) {
    if (node == null || typeof node !== 'object' || !(key in node)) return undefined;
    node = node[key];
  }
  return node;
}

export function createI18n(packlabApi, initialLang = 'en') {
  let lang = packlabApi.i18n.supportedLanguages.includes(initialLang) ? initialLang : 'en';
  let data = packlabApi.i18n.load(lang);
  const listeners = new Set();

  function t(keyPath, fallback) {
    const value = resolveKey(data, keyPath);
    return value !== undefined ? value : fallback !== undefined ? fallback : keyPath;
  }

  function setLanguage(newLang) {
    if (!packlabApi.i18n.supportedLanguages.includes(newLang) || newLang === lang) return;
    lang = newLang;
    data = packlabApi.i18n.load(lang);
    listeners.forEach((fn) => fn(lang));
  }

  function applyToDom(root) {
    (root || document).querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return {
    t,
    setLanguage,
    applyToDom,
    onChange,
    get language() {
      return lang;
    },
    get supportedLanguages() {
      return packlabApi.i18n.supportedLanguages;
    },
  };
}
