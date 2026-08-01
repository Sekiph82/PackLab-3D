// Material codes are technical standards (PET/PP/HDPE/LDPE/PE) — never translated.
const MATERIALS = ['PET', 'PP', 'HDPE', 'LDPE', 'PE'];

export function mountMaterialSelector(container, { i18n, store }) {
  function render() {
    const state = store.getState().label || {};
    container.innerHTML = '';

    const field = document.createElement('div');
    field.className = 'field';
    const label = document.createElement('label');
    label.textContent = i18n.t('form.material');
    const select = document.createElement('select');

    const autoOpt = document.createElement('option');
    autoOpt.value = '';
    autoOpt.textContent = '(auto)';
    select.appendChild(autoOpt);

    MATERIALS.forEach((code) => {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = code;
      if (state.material === code) opt.selected = true;
      select.appendChild(opt);
    });

    select.addEventListener('change', () => {
      store.setState({ label: { ...state, material: select.value || null } });
    });

    field.append(label, select);
    container.appendChild(field);
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
