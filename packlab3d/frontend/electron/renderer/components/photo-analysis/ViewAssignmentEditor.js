import { actionButton, el, tr } from '../editorUtils.js';

const VIEW_ORDER = ['front', 'back', 'left', 'right', 'top', 'bottom', 'front_left', 'front_right', 'back_left', 'back_right', 'custom'];

export function suggestedViewFromPhoto(photo, existing = []) {
  const assigned = photo.camera?.assignedView;
  if (assigned && VIEW_ORDER.includes(assigned)) return assigned;
  const width = Number(photo.width || photo.workingWidth || 0);
  const height = Number(photo.height || photo.workingHeight || 1);
  const ratio = width / Math.max(height, 1);
  const used = new Set(existing.map((item) => item.viewType).filter(Boolean));
  if (ratio > 1.15 && !used.has('top')) return 'top';
  if (ratio < 0.45 && !used.has('left')) return 'left';
  const qualityRoles = photo.quality?.recommendedRoles || [];
  const role = qualityRoles.find((item) => VIEW_ORDER.includes(item));
  if (role) return role;
  for (const view of ['front', 'right', 'back', 'left', 'front_right', 'front_left', 'top', 'bottom']) {
    if (!used.has(view)) return view;
  }
  return 'custom';
}

export function applyEvidenceBasedViewAssignments(photos) {
  const assigned = [];
  photos.forEach((photo) => {
    photo.viewType = suggestedViewFromPhoto(photo, assigned);
    photo.manualViewOverride = false;
    assigned.push(photo);
  });
  return photos;
}

export function mountViewAssignmentEditor(container, { i18n, photos, onChange }) {
  container.innerHTML = '';
  const panel = el('section', 'photo-analysis-panel');
  panel.appendChild(el('h3', 'interactive-editor__title', tr('phase7.view.assignmentEditor', 'View Assignment', i18n)));
  panel.appendChild(actionButton(tr('photos.autoAssignViews', 'Auto-Assign Views', i18n), () => {
    applyEvidenceBasedViewAssignments(photos);
    onChange?.(photos);
    renderRows();
  }));
  const rows = el('div', 'photo-analysis-panel__rows');
  panel.appendChild(rows);
  container.appendChild(panel);
  renderRows();

  function renderRows() {
    rows.innerHTML = '';
    photos.forEach((photo) => {
      const row = el('label', 'photo-analysis-panel__row');
      const title = el('span', null, photo.originalName);
      const select = document.createElement('select');
      VIEW_ORDER.forEach((view) => {
        const option = document.createElement('option');
        option.value = view;
        option.textContent = view.replace('_', '-');
        option.selected = photo.viewType === view;
        select.appendChild(option);
      });
      const evidence = el('small', null, (photo.camera?.reasoning || photo.quality?.warnings || []).slice(0, 2).join('; '));
      select.addEventListener('change', () => {
        photo.viewType = select.value;
        photo.manualViewOverride = true;
        onChange?.(photos);
      });
      row.append(title, select, evidence);
      rows.appendChild(row);
    });
  }
}
