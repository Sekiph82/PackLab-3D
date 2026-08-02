import { actionButton, el, tr } from '../editorUtils.js';

export function mountAutosaveStatus(container, { i18n, projectId, dirty, lastSaved, recovery, onAutosave, onRestore, onDiscard }) {
  container.innerHTML = '';
  const panel = el('section', 'autosave-status');
  const status = el('div', 'autosave-status__text');
  const actions = el('div', 'interactive-editor__toolbar');
  actions.append(
    actionButton(tr('phase7.autosave.saveNow', 'Save Recovery Now', i18n), () => onAutosave?.()),
    actionButton(tr('phase7.recovery.restore', 'Restore Recovery', i18n), () => onRestore?.(), 'editor-button editor-button--warning'),
    actionButton(tr('phase7.recovery.discard', 'Discard Recovery', i18n), () => onDiscard?.()),
  );
  panel.append(status, actions);
  container.appendChild(panel);
  status.textContent = [
    `${tr('phase7.autosave.project', 'Project', i18n)}: ${projectId || '-'}`,
    `${tr('phase7.autosave.dirty', 'Dirty', i18n)}: ${dirty ? tr('common.yes', 'Yes', i18n) : tr('common.no', 'No', i18n)}`,
    `${tr('phase7.autosave.lastSaved', 'Last saved', i18n)}: ${lastSaved || '-'}`,
    `${tr('phase7.recovery.available', 'Recovery available', i18n)}: ${recovery?.available ? tr('common.yes', 'Yes', i18n) : tr('common.no', 'No', i18n)}`,
  ].join(' | ');
}
