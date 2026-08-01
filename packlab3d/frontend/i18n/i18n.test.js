const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { I18n, SUPPORTED_LANGUAGES } = require('./index.js');

function flattenKeys(obj, prefix = '') {
  return Object.keys(obj).reduce((acc, key) => {
    const value = obj[key];
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      acc.push(...flattenKeys(value, fullKey));
    } else {
      acc.push(fullKey);
    }
    return acc;
  }, []);
}

// All language files must expose the same set of keys.
const keySets = SUPPORTED_LANGUAGES.map((lang) => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, `${lang}.json`), 'utf-8'));
  return flattenKeys(data).sort();
});
keySets.slice(1).forEach((keys, idx) => {
  assert.deepStrictEqual(keys, keySets[0], `Key mismatch between en and ${SUPPORTED_LANGUAGES[idx + 1]}`);
});

// Default language and lookups.
const i18n = new I18n();
assert.strictEqual(i18n.currentLanguage, 'en');
assert.strictEqual(i18n.t('splash.slogan'), 'Precision Packaging Design.');

i18n.setLanguage('tr');
assert.strictEqual(i18n.t('splash.slogan'), 'Hassas Ambalaj Tasarımı');

i18n.setLanguage('sw');
assert.strictEqual(i18n.t('splash.slogan'), 'Ubunifu wa Ufungaji wa Usahihi');

// Missing key falls back to the key path itself.
assert.strictEqual(i18n.t('nonexistent.key'), 'nonexistent.key');

// Unsupported language rejected.
assert.throws(() => i18n.setLanguage('fr'), /Unsupported language/);

console.log('All frontend i18n tests passed.');
