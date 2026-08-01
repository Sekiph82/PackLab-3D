// Style names are brand identifiers (PackLab3D_BrandIdentity.md) — never translated.
const STYLES = [
  { value: 'minimal_modern', name: 'Minimal Modern', color: '#0057FF' },
  { value: 'premium_gold', name: 'Premium Gold', color: '#C9A86A' },
  { value: 'eco_green', name: 'Eco Green', color: '#00D26A' },
  { value: 'industrial_tech', name: 'Industrial Tech', color: '#3A4A5A' },
  { value: 'bold_colorful', name: 'Bold Colorful', color: '#FF3366' },
];

export function mountLabelStyleSelector(container, { i18n, store }) {
  function render() {
    const state = store.getState().label || {};
    container.innerHTML = '';
    const title = document.createElement('div');
    title.textContent = i18n.t('label.style');
    title.style.fontSize = '12px';
    title.style.marginBottom = '6px';
    container.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'swatch-grid';
    STYLES.forEach((style) => {
      const btn = document.createElement('div');
      btn.className = 'swatch' + (state.style === style.value ? ' selected' : '');
      btn.setAttribute('role', 'button');
      btn.tabIndex = 0;
      const dot = document.createElement('span');
      dot.className = 'swatch-dot';
      dot.style.background = style.color;
      const label = document.createElement('span');
      label.textContent = style.name;
      btn.append(dot, label);
      btn.addEventListener('click', () => {
        store.setState({ label: { ...state, style: style.value } });
      });
      grid.appendChild(btn);
    });
    container.appendChild(grid);
  }

  const unsubscribeStore = store.subscribe(render);
  const unsubscribeI18n = i18n.onChange(render);
  render();

  return {
    render,
    destroy() {
      unsubscribeStore();
      unsubscribeI18n();
    },
  };
}
