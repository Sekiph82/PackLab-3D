const SHAPES = ['rectangle', 'square', 'circle', 'oval', 'wrap_around', 'sachet_label', 'cap_label'];

// tasks.md's shapes.rectangle/oval/wrapAround/sachetLabel/capLabel i18n keys +
// square/circle added for the two shapes this stage introduced beyond tasks.md.
const SHAPE_I18N_KEY = {
  rectangle: 'label.shapes.rectangle',
  square: 'label.shapes.square',
  circle: 'label.shapes.circle',
  oval: 'label.shapes.oval',
  wrap_around: 'label.shapes.wrapAround',
  sachet_label: 'label.shapes.sachetLabel',
  cap_label: 'label.shapes.capLabel',
};

export function mountLabelShapeSelector(container, { i18n, store }) {
  function render() {
    const state = store.getState().label || {};
    container.innerHTML = '';
    const title = document.createElement('div');
    title.textContent = i18n.t('label.shape');
    title.style.fontSize = '12px';
    title.style.marginBottom = '6px';
    container.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'shape-grid';
    SHAPES.forEach((shape) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'shape-btn' + (state.shape === shape ? ' selected' : '');
      btn.textContent = i18n.t(SHAPE_I18N_KEY[shape], shape);
      btn.addEventListener('click', () => {
        store.setState({ label: { ...state, shape } });
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
