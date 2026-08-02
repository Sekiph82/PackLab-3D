export function tr(key, fallback, i18n) {
  return i18n?.t ? i18n.t(key, fallback) : fallback;
}

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function actionButton(label, onClick, className = 'editor-button') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

export function svgEl(tag, attrs = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

export function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value)));
}

export function localPoint(event, node, width = 320, height = 220) {
  const rect = node.getBoundingClientRect();
  const x = rect.width ? ((event.clientX - rect.left) / rect.width) * width : event.offsetX;
  const y = rect.height ? ((event.clientY - rect.top) / rect.height) * height : event.offsetY;
  return { x, y };
}

export function makePanel(title) {
  const panel = el('section', 'interactive-editor');
  const heading = el('h3', 'interactive-editor__title', title);
  panel.appendChild(heading);
  return panel;
}

export function checksum(values) {
  let hash = 2166136261;
  for (let index = 0; index < values.length; index += 1) {
    hash ^= values[index] & 0xff;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
