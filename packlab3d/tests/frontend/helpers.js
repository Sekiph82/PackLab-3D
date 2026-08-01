import { createStore } from '../../frontend/electron/renderer/state.js';

const FIXTURES = {
  en: {
    splash: { appName: 'PackLab 3D', slogan: 'Precision Packaging Design.' },
    nav: { measurements: 'Measurements' },
    form: {
      packagingType: 'Packaging Type',
      width: 'Width',
      height: 'Height',
      depth: 'Depth',
      diameter: 'Diameter',
      volume: 'Volume',
      material: 'Material',
      uploadPhoto: 'Upload Photo',
      packagingTypes: { bottle: 'Bottle', box: 'Box', sachet: 'Sachet', jerrycan: 'Jerrycan' },
    },
    label: {
      title: 'Label Design',
      style: 'Style',
      shape: 'Shape',
      shapes: {
        rectangle: 'Rectangle',
        square: 'Square',
        circle: 'Circle',
        oval: 'Oval',
        wrapAround: 'Wrap-around',
        sachetLabel: 'Sachet Label',
        capLabel: 'Cap Label',
      },
      content: { logo: 'Logo' },
    },
    common: { requiredField: 'This field is required.', invalidNumber: 'Please enter a valid number.' },
  },
  tr: {
    splash: { appName: 'PackLab 3D', slogan: 'Hassas Ambalaj Tasarımı' },
    nav: { measurements: 'Ölçümler' },
    form: {
      packagingType: 'Ambalaj Türü',
      width: 'Genişlik',
      height: 'Yükseklik',
      depth: 'Derinlik',
      diameter: 'Çap',
      volume: 'Hacim',
      material: 'Malzeme',
      uploadPhoto: 'Fotoğraf Yükle',
      packagingTypes: { bottle: 'Şişe', box: 'Kutu', sachet: 'Saşe', jerrycan: 'Bidon' },
    },
    label: {
      title: 'Etiket Tasarımı',
      style: 'Stil',
      shape: 'Şekil',
      shapes: {
        rectangle: 'Dikdörtgen',
        square: 'Kare',
        circle: 'Daire',
        oval: 'Oval',
        wrapAround: 'Sarma',
        sachetLabel: 'Saşe Etiketi',
        capLabel: 'Kapak Etiketi',
      },
      content: { logo: 'Logo' },
    },
    common: { requiredField: 'Bu alan zorunludur.', invalidNumber: 'Lütfen geçerli bir sayı girin.' },
  },
  sw: {
    splash: { appName: 'PackLab 3D', slogan: 'Ubunifu wa Ufungaji wa Usahihi' },
    nav: { measurements: 'Vipimo' },
    form: {
      packagingType: 'Aina ya Ufungaji',
      width: 'Upana',
      height: 'Urefu',
      depth: 'Kina',
      diameter: 'Kipenyo',
      volume: 'Ujazo',
      material: 'Nyenzo',
      uploadPhoto: 'Pakia Picha',
      packagingTypes: { bottle: 'Chupa', box: 'Sanduku', sachet: 'Kifuko', jerrycan: 'Jerikeni' },
    },
    label: {
      title: 'Ubunifu wa Lebo',
      style: 'Mtindo',
      shape: 'Umbo',
      shapes: {
        rectangle: 'Mstatili',
        square: 'Mraba',
        circle: 'Duara',
        oval: 'Mviringo',
        wrapAround: 'Kuzunguka',
        sachetLabel: 'Lebo ya Kifuko',
        capLabel: 'Lebo ya Kifuniko',
      },
      content: { logo: 'Nembo' },
    },
    common: { requiredField: 'Sehemu hii inahitajika.', invalidNumber: 'Tafadhali weka nambari sahihi.' },
  },
};

function resolveKey(data, keyPath) {
  const keys = keyPath.split('.');
  let node = data;
  for (const key of keys) {
    if (node == null || typeof node !== 'object' || !(key in node)) return undefined;
    node = node[key];
  }
  return node;
}

export function createFakeI18n(initialLang = 'en') {
  let lang = initialLang;
  const listeners = new Set();

  return {
    supportedLanguages: ['en', 'tr', 'sw'],
    get language() {
      return lang;
    },
    t(keyPath, fallback) {
      const value = resolveKey(FIXTURES[lang], keyPath);
      return value !== undefined ? value : fallback !== undefined ? fallback : keyPath;
    },
    setLanguage(newLang) {
      if (!['en', 'tr', 'sw'].includes(newLang) || newLang === lang) return;
      lang = newLang;
      listeners.forEach((fn) => fn(newLang));
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    applyToDom(root) {
      (root || document).querySelectorAll('[data-i18n]').forEach((el) => {
        el.textContent = this.t(el.getAttribute('data-i18n'));
      });
    },
  };
}

export function createTestStore(initial) {
  return createStore(initial);
}
