import { actionButton, el, makePanel, tr } from '../editorUtils.js';

export function mountVersionManager(container, { i18n, versions = [], comparison, onSave, onCompare, onRestore, onDirty }) {
  container.innerHTML = '';
  const panel = makePanel(tr('phase7.version.manager', 'Version Manager', i18n));
  const toolbar = el('div', 'interactive-editor__toolbar');
  const name = document.createElement('input');
  name.type = 'text';
  name.placeholder = tr('phase7.version.namePlaceholder', 'Version name', i18n);
  const note = document.createElement('input');
  note.type = 'text';
  note.placeholder = tr('phase7.version.notePlaceholder', 'Version note', i18n);
  const left = document.createElement('select');
  const right = document.createElement('select');
  const list = el('div', 'version-manager__list');
  const compare = el('div', 'version-manager__comparison');

  toolbar.append(
    name,
    note,
    actionButton(tr('phase7.version.save', 'Save Version', i18n), async () => {
      await onSave?.({ name: name.value, note: note.value });
      onDirty?.({ type: 'version-save' });
    }),
    left,
    right,
    actionButton(tr('phase7.version.compare', 'Compare Versions', i18n), async () => {
      if (!left.value || !right.value || left.value === right.value) return;
      await onCompare?.(left.value, right.value);
    }),
    actionButton(tr('phase7.version.restore', 'Restore Version', i18n), async () => {
      if (!left.value || !window.confirm?.(tr('phase7.version.restoreConfirm', 'Restore the selected version? A pre-restore snapshot will be created.', i18n))) return;
      await onRestore?.(left.value);
    }),
  );
  panel.append(toolbar, list, compare);
  container.appendChild(panel);
  render();

  function render() {
    [left, right].forEach((select, selectIndex) => {
      select.innerHTML = '';
      versions.forEach((version, versionIndex) => {
        const option = document.createElement('option');
        option.value = version.id;
        option.textContent = `${version.name || version.id} ${version.timestamp || ''}`;
        if ((selectIndex === 0 && versionIndex === 0) || (selectIndex === 1 && versionIndex === Math.min(1, versions.length - 1))) {
          option.selected = true;
        }
        select.appendChild(option);
      });
    });
    list.innerHTML = '';
    versions.forEach((version) => {
      const item = el('div', 'version-manager__item');
      item.textContent = `${version.name || version.id} | ${version.status || 'working'} | ${version.userNote || ''}`;
      list.appendChild(item);
    });
    compare.innerHTML = '';
    if (comparison) {
      const changes = comparison.changes || [];
      changes.forEach((change) => compare.appendChild(el('div', 'version-manager__change', change)));
      if (!changes.length) compare.textContent = tr('phase7.version.noChanges', 'No visible changes detected.', i18n);
    }
  }
}
