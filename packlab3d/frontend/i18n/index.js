const fs = require('fs');
const path = require('path');

const SUPPORTED_LANGUAGES = ['en', 'tr', 'sw'];
const DEFAULT_LANGUAGE = 'en';

function loadLanguageFile(lang) {
  const filePath = path.join(__dirname, `${lang}.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

class I18n {
  constructor(defaultLanguage = DEFAULT_LANGUAGE) {
    this.translations = {};
    SUPPORTED_LANGUAGES.forEach((lang) => {
      this.translations[lang] = loadLanguageFile(lang);
    });
    this.currentLanguage = SUPPORTED_LANGUAGES.includes(defaultLanguage)
      ? defaultLanguage
      : DEFAULT_LANGUAGE;
  }

  setLanguage(lang) {
    if (!SUPPORTED_LANGUAGES.includes(lang)) {
      throw new Error(`Unsupported language: ${lang}`);
    }
    this.currentLanguage = lang;
  }

  t(keyPath, lang = this.currentLanguage) {
    const node = this._resolve(keyPath, lang);
    if (node === undefined && lang !== DEFAULT_LANGUAGE) {
      return this.t(keyPath, DEFAULT_LANGUAGE);
    }
    return node !== undefined ? node : keyPath;
  }

  _resolve(keyPath, lang) {
    let node = this.translations[lang];
    for (const key of keyPath.split('.')) {
      if (node == null || !(key in node)) {
        return undefined;
      }
      node = node[key];
    }
    return node;
  }
}

module.exports = { I18n, SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE };
