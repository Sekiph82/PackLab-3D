export function mountLanguageSwitcher(container, { i18n }) {
  function render() {
    container.innerHTML = '';
    i18n.supportedLanguages.forEach((lang) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = i18n.t(`language.${lang}`, lang.toUpperCase());
      btn.className = lang === i18n.language ? 'active' : '';
      btn.dataset.lang = lang;
      btn.addEventListener('click', () => i18n.setLanguage(lang));
      container.appendChild(btn);
    });
  }

  render();
  i18n.onChange(render);
  return { render };
}
