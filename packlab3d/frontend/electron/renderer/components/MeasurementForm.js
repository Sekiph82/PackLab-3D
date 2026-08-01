import { validateMeasurementForm } from '../validation.js';

const PACKAGING_TYPES = ['bottle', 'box', 'sachet', 'jerrycan'];
const DIMENSION_FIELDS = [
  ['widthMm', 'form.width'],
  ['heightMm', 'form.height'],
  ['depthMm', 'form.depth'],
  ['diameterMm', 'form.diameter'],
  ['volumeMl', 'form.volume'],
];

export function mountMeasurementForm(container, { i18n, store }) {
  function update(patch) {
    const current = store.getState().measurement || {};
    store.setState({ measurement: { ...current, ...patch } });
  }

  function render() {
    const state = store.getState().measurement || {};
    container.innerHTML = '';

    const typeField = document.createElement('div');
    typeField.className = 'field';
    const typeLabel = document.createElement('label');
    typeLabel.textContent = i18n.t('form.packagingType');
    const typeSelect = document.createElement('select');
    PACKAGING_TYPES.forEach((type) => {
      const opt = document.createElement('option');
      opt.value = type;
      opt.textContent = i18n.t(`form.packagingTypes.${type}`, type);
      if (state.packagingType === type) opt.selected = true;
      typeSelect.appendChild(opt);
    });
    typeSelect.addEventListener('change', () => update({ packagingType: typeSelect.value }));
    typeField.append(typeLabel, typeSelect);
    container.appendChild(typeField);

    DIMENSION_FIELDS.forEach(([key, i18nKey]) => {
      const field = document.createElement('div');
      field.className = 'field';
      const label = document.createElement('label');
      label.textContent = i18n.t(i18nKey);
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = 'any';
      input.value = state[key] ?? '';
      input.addEventListener('input', () => update({ [key]: input.value }));
      const error = document.createElement('div');
      error.className = 'field-error';
      field.append(label, input, error);
      container.appendChild(field);
    });

    const errors = validateMeasurementForm(state);
    const errorNodes = container.querySelectorAll('.field-error');
    DIMENSION_FIELDS.forEach(([key], index) => {
      if (errors[key]) errorNodes[index].textContent = i18n.t(errors[key]);
    });

    // 'dimensions' is a form-level error (no single field is wrong, none were
    // filled in at all) — it has no per-field slot, so render it separately.
    if (errors.dimensions) {
      const formError = document.createElement('div');
      formError.className = 'field-error';
      formError.setAttribute('data-form-error', 'dimensions');
      formError.textContent = i18n.t(errors.dimensions);
      container.appendChild(formError);
    }
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
