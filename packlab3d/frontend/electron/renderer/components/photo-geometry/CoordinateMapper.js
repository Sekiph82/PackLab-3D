function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function normalizeRotation(rotation = 0) {
  const value = Number(rotation) || 0;
  return ((value % 360) + 360) % 360;
}

export function createCoordinateMapper(config = {}) {
  const sourceWidth = Number(config.sourceWidth || config.imageWidth || 1);
  const sourceHeight = Number(config.sourceHeight || config.imageHeight || 1);
  const workingWidth = Number(config.workingWidth || sourceWidth || 1);
  const workingHeight = Number(config.workingHeight || sourceHeight || 1);
  const viewportWidth = Number(config.viewportWidth || config.canvasWidth || workingWidth || 1);
  const viewportHeight = Number(config.viewportHeight || config.canvasHeight || workingHeight || 1);
  const zoom = Number(config.zoom || 1);
  const panX = Number(config.panX || 0);
  const panY = Number(config.panY || 0);
  const devicePixelRatio = Number(config.devicePixelRatio || globalThis.devicePixelRatio || 1);
  const rotation = normalizeRotation(config.rotation);
  const objectBounds = config.objectBounds || { x: 0, y: 0, width: 1, height: 1 };
  const centerlineX = Number(config.centerlineX ?? (objectBounds.x + objectBounds.width / 2));
  const supportPlaneY = Number(config.supportPlaneY ?? (objectBounds.y + objectBounds.height));

  const fitScale = Math.min(viewportWidth / workingWidth, viewportHeight / workingHeight) * zoom;
  const fittedWidth = workingWidth * fitScale;
  const fittedHeight = workingHeight * fitScale;
  const offsetX = (viewportWidth - fittedWidth) / 2 + panX;
  const offsetY = (viewportHeight - fittedHeight) / 2 + panY;

  function unrotateNormalized(point) {
    const x = Number(point.x);
    const y = Number(point.y);
    if (rotation === 90) return { x: y, y: 1 - x };
    if (rotation === 180) return { x: 1 - x, y: 1 - y };
    if (rotation === 270) return { x: 1 - y, y: x };
    return { x, y };
  }

  function rotateNormalized(point) {
    const x = Number(point.x);
    const y = Number(point.y);
    if (rotation === 90) return { x: 1 - y, y: x };
    if (rotation === 180) return { x: 1 - x, y: 1 - y };
    if (rotation === 270) return { x: y, y: 1 - x };
    return { x, y };
  }

  function sourceToWorking(point) {
    const normalized = {
      x: Number(point.sourceX ?? point.x) / sourceWidth,
      y: Number(point.sourceY ?? point.y) / sourceHeight,
    };
    const rotated = rotateNormalized(normalized);
    return { workingX: rotated.x * workingWidth, workingY: rotated.y * workingHeight };
  }

  function workingToSource(point) {
    const normalized = {
      x: Number(point.workingX ?? point.x) / workingWidth,
      y: Number(point.workingY ?? point.y) / workingHeight,
    };
    const unrotated = unrotateNormalized(normalized);
    return { sourceX: unrotated.x * sourceWidth, sourceY: unrotated.y * sourceHeight };
  }

  function workingToNormalized(point) {
    return {
      normalizedX: clamp(Number(point.workingX ?? point.x) / workingWidth),
      normalizedY: clamp(Number(point.workingY ?? point.y) / workingHeight),
    };
  }

  function normalizedToWorking(point) {
    return {
      workingX: clamp(Number(point.normalizedX ?? point.x)) * workingWidth,
      workingY: clamp(Number(point.normalizedY ?? point.y)) * workingHeight,
    };
  }

  function normalizedToCanvasCss(point) {
    const working = normalizedToWorking(point);
    return {
      canvasCssX: offsetX + working.workingX * fitScale,
      canvasCssY: offsetY + working.workingY * fitScale,
    };
  }

  function canvasCssToNormalized(point) {
    return workingToNormalized({
      workingX: (Number(point.canvasCssX ?? point.x) - offsetX) / fitScale,
      workingY: (Number(point.canvasCssY ?? point.y) - offsetY) / fitScale,
    });
  }

  function normalizedToCanvasPixels(point) {
    const css = normalizedToCanvasCss(point);
    return {
      canvasPixelX: css.canvasCssX * devicePixelRatio,
      canvasPixelY: css.canvasCssY * devicePixelRatio,
    };
  }

  function canvasPixelsToNormalized(point) {
    return canvasCssToNormalized({
      canvasCssX: Number(point.canvasPixelX ?? point.x) / devicePixelRatio,
      canvasCssY: Number(point.canvasPixelY ?? point.y) / devicePixelRatio,
    });
  }

  function sourceToCanvasCss(point) {
    const working = sourceToWorking(point);
    const normalized = workingToNormalized(working);
    return normalizedToCanvasCss(normalized);
  }

  function canvasCssToSource(point) {
    const normalized = canvasCssToNormalized(point);
    const working = normalizedToWorking(normalized);
    return workingToSource(working);
  }

  function normalizedImageToModel(point) {
    const x = Number(point.normalizedX ?? point.x);
    const y = Number(point.normalizedY ?? point.y);
    const height = Math.max(Number(objectBounds.height || 1), 1e-9);
    return {
      modelX: (x - centerlineX) / height,
      modelY: (supportPlaneY - y) / height,
    };
  }

  function modelToNormalizedImage(point) {
    const height = Math.max(Number(objectBounds.height || 1), 1e-9);
    return {
      normalizedX: centerlineX + Number(point.modelX ?? point.x) * height,
      normalizedY: supportPlaneY - Number(point.modelY ?? point.y) * height,
    };
  }

  return {
    config: {
      sourceWidth,
      sourceHeight,
      workingWidth,
      workingHeight,
      viewportWidth,
      viewportHeight,
      zoom,
      panX,
      panY,
      devicePixelRatio,
      rotation,
      objectBounds,
      centerlineX,
      supportPlaneY,
      fitScale,
      offsetX,
      offsetY,
    },
    sourceToWorking,
    workingToSource,
    workingToNormalized,
    normalizedToWorking,
    normalizedToCanvasCss,
    canvasCssToNormalized,
    normalizedToCanvasPixels,
    canvasPixelsToNormalized,
    sourceToCanvasCss,
    canvasCssToSource,
    normalizedImageToModel,
    modelToNormalizedImage,
  };
}
