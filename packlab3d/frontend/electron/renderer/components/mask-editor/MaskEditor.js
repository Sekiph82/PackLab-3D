import { actionButton, checksum, clamp, el, makePanel, tr } from '../editorUtils.js';
import { createCoordinateMapper } from '../photo-geometry/CoordinateMapper.js';

const WIDTH = 192;
const HEIGHT = 256;

export function mountMaskEditor(container, { i18n, photo, onSaveMask, onDirty }) {
  container.innerHTML = '';
  const panel = makePanel(tr('phase7.mask.editor', 'Mask Editor', i18n));
  const toolbar = el('div', 'interactive-editor__toolbar');
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.className = 'mask-editor__canvas';
  const status = el('div', 'interactive-editor__status');
  const brush = document.createElement('input');
  brush.type = 'range';
  brush.min = '4';
  brush.max = '36';
  brush.value = '14';
  brush.title = tr('phase7.mask.brushSize', 'Brush size', i18n);
  const opacity = document.createElement('input');
  opacity.type = 'range';
  opacity.min = '15';
  opacity.max = '90';
  opacity.value = '55';
  opacity.title = tr('phase7.mask.overlayOpacity', 'Overlay opacity', i18n);

  let tool = 'foreground';
  let drawing = false;
  let mask = new Uint8Array(WIDTH * HEIGHT);
  let undoStack = [];
  let redoStack = [];
  let beforeChecksum = checksum(mask);
  const revisions = photo?.geometry?.revisions || photo?.manualMask?.revisions || {};
  let currentRevision = Number(revisions.activeMask ?? revisions.manualMask ?? photo?.manualMask?.revision ?? 0);
  const mapper = createCoordinateMapper({
    sourceWidth: photo?.width || photo?.workingWidth || WIDTH,
    sourceHeight: photo?.height || photo?.workingHeight || HEIGHT,
    workingWidth: WIDTH,
    workingHeight: HEIGHT,
    viewportWidth: WIDTH,
    viewportHeight: HEIGHT,
    rotation: photo?.rotation || 0,
  });

  let ctx = null;
  if (!/jsdom/i.test(globalThis.navigator?.userAgent || '')) {
    try {
      ctx = canvas.getContext?.('2d') || null;
    } catch (_err) {
      ctx = null;
    }
  }
  if (ctx) {
    const image = new Image();
    image.onload = () => paint();
    image.src = photo?.url || '';
  }
  seedAutomaticMask();
  paint();

  toolbar.append(
    actionButton(tr('phase7.mask.foregroundBrush', 'Foreground Brush', i18n), () => { tool = 'foreground'; updateStatus(); }),
    actionButton(tr('phase7.mask.backgroundBrush', 'Background Brush', i18n), () => { tool = 'background'; updateStatus(); }),
    actionButton(tr('phase7.mask.fillHole', 'Fill Hole', i18n), fillHole),
    actionButton(tr('phase7.mask.removeComponent', 'Remove Component', i18n), removeSmallComponent),
    actionButton(tr('common.undo', 'Undo', i18n), undo),
    actionButton(tr('common.redo', 'Redo', i18n), redo),
    actionButton(tr('phase7.mask.resetAutomatic', 'Reset Automatic Mask', i18n), resetAutomatic),
    actionButton(tr('phase7.mask.save', 'Save Mask', i18n), save),
    brush,
    opacity,
  );
  panel.append(toolbar, canvas, status);
  container.appendChild(panel);

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', stop);
  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', move);
  window.addEventListener('pointerup', stop);
  opacity.addEventListener('input', paint);

  function seedAutomaticMask() {
    const marginX = Math.round(WIDTH * 0.22);
    const marginY = Math.round(HEIGHT * 0.08);
    for (let y = marginY; y < HEIGHT - marginY; y += 1) {
      for (let x = marginX; x < WIDTH - marginX; x += 1) {
        mask[y * WIDTH + x] = 255;
      }
    }
    beforeChecksum = checksum(mask);
    updateStatus();
  }

  function snapshot() {
    undoStack.push(mask.slice());
    redoStack = [];
  }

  function start(event) {
    drawing = true;
    snapshot();
    drawAt(event);
  }

  function move(event) {
    if (!drawing) return;
    drawAt(event);
  }

  function stop() {
    if (!drawing) return;
    drawing = false;
    onDirty?.({ type: 'mask-edit', photoId: photo?.uploadedId || photo?.id });
    updateStatus();
  }

  function drawAt(event) {
    event.preventDefault();
    const point = pointForEvent(event);
    const radius = Number(brush.value);
    const value = tool === 'foreground' ? 255 : 0;
    const minY = Math.max(0, Math.floor(point.y - radius));
    const maxY = Math.min(HEIGHT - 1, Math.ceil(point.y + radius));
    const minX = Math.max(0, Math.floor(point.x - radius));
    const maxX = Math.min(WIDTH - 1, Math.ceil(point.x + radius));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (((x - point.x) ** 2) + ((y - point.y) ** 2) <= radius ** 2) {
          mask[y * WIDTH + x] = value;
        }
      }
    }
    paint();
  }

  function fillHole() {
    snapshot();
    for (let y = 1; y < HEIGHT - 1; y += 1) {
      for (let x = 1; x < WIDTH - 1; x += 1) {
        const index = y * WIDTH + x;
        if (!mask[index] && mask[index - 1] && mask[index + 1] && mask[index - WIDTH] && mask[index + WIDTH]) {
          mask[index] = 255;
        }
      }
    }
    onDirty?.({ type: 'mask-fill-hole', photoId: photo?.uploadedId || photo?.id });
    paint();
    updateStatus();
  }

  function removeSmallComponent() {
    snapshot();
    const centerX = WIDTH / 2;
    const centerY = HEIGHT / 2;
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        if (Math.abs(x - centerX) > WIDTH * 0.42 || Math.abs(y - centerY) > HEIGHT * 0.45) {
          mask[y * WIDTH + x] = 0;
        }
      }
    }
    onDirty?.({ type: 'mask-remove-component', photoId: photo?.uploadedId || photo?.id });
    paint();
    updateStatus();
  }

  function undo() {
    const previous = undoStack.pop();
    if (!previous) return;
    redoStack.push(mask.slice());
    mask = previous;
    paint();
    updateStatus();
  }

  function redo() {
    const next = redoStack.pop();
    if (!next) return;
    undoStack.push(mask.slice());
    mask = next;
    paint();
    updateStatus();
  }

  function resetAutomatic() {
    snapshot();
    mask.fill(0);
    seedAutomaticMask();
    onDirty?.({ type: 'mask-reset', photoId: photo?.uploadedId || photo?.id });
    paint();
  }

  async function save() {
    const payload = {
      photoId: photo?.uploadedId || photo?.id,
      width: WIDTH,
      height: HEIGHT,
      checksum: checksum(mask),
      maskData: Array.from(mask),
      expectedRevision: currentRevision,
    };
    const result = await onSaveMask?.(payload);
    currentRevision = Number(result?.geometry?.revisions?.activeMask ?? result?.mask?.revision ?? currentRevision + 1);
    beforeChecksum = payload.checksum;
    updateStatus(tr('phase7.mask.saved', 'Manual mask saved and contour recalculated.', i18n));
  }

  function pointForEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const normalized = mapper.canvasCssToNormalized({
      canvasCssX: event.clientX - rect.left,
      canvasCssY: event.clientY - rect.top,
    });
    const working = mapper.normalizedToWorking(normalized);
    return { x: working.workingX, y: working.workingY };
  }

  function paint() {
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    if (photo?.url) {
      const image = new Image();
      image.onload = () => {
        ctx.drawImage(image, 0, 0, WIDTH, HEIGHT);
        paintMask();
      };
      image.src = photo.url;
    } else {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      paintMask();
    }
  }

  function paintMask() {
    if (!ctx) return;
    const alpha = clamp(Number(opacity.value) / 100, 0.15, 0.9);
    ctx.fillStyle = `rgba(0, 116, 255, ${alpha})`;
    for (let y = 0; y < HEIGHT; y += 2) {
      for (let x = 0; x < WIDTH; x += 2) {
        if (mask[y * WIDTH + x]) ctx.fillRect(x, y, 2, 2);
      }
    }
  }

  function updateStatus(message) {
    status.textContent = message || `${tr('phase7.mask.checksum', 'Mask checksum', i18n)}: ${checksum(mask)} (${checksum(mask) === beforeChecksum ? tr('common.saved', 'Saved', i18n) : tr('common.unsaved', 'Unsaved', i18n)})`;
  }

  return {
    getMaskChecksum: () => checksum(mask),
    destroy() {
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('pointerup', stop);
    },
  };
}
