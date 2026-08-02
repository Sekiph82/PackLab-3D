import { createCoordinateMapper } from './CoordinateMapper.js';

function close(a, b, tolerance = 1e-6) {
  expect(Math.abs(a - b)).toBeLessThan(tolerance);
}

test('identity source-normalized-working round trip', () => {
  const mapper = createCoordinateMapper({ sourceWidth: 100, sourceHeight: 200, workingWidth: 100, workingHeight: 200, viewportWidth: 100, viewportHeight: 200 });
  const working = mapper.sourceToWorking({ sourceX: 25, sourceY: 50 });
  close(working.workingX, 25);
  close(working.workingY, 50);
  const source = mapper.workingToSource(working);
  close(source.sourceX, 25);
  close(source.sourceY, 50);
});

test('source to normalized and back keeps non-square image coordinates', () => {
  const mapper = createCoordinateMapper({ sourceWidth: 400, sourceHeight: 200, workingWidth: 200, workingHeight: 100, viewportWidth: 300, viewportHeight: 180 });
  const working = mapper.sourceToWorking({ sourceX: 320, sourceY: 80 });
  const normalized = mapper.workingToNormalized(working);
  const back = mapper.workingToSource(mapper.normalizedToWorking(normalized));
  close(back.sourceX, 320);
  close(back.sourceY, 80);
});

test('normalized to canvas and back with devicePixelRatio 1', () => {
  const mapper = createCoordinateMapper({ workingWidth: 100, workingHeight: 100, viewportWidth: 200, viewportHeight: 200, devicePixelRatio: 1 });
  const css = mapper.normalizedToCanvasCss({ normalizedX: 0.25, normalizedY: 0.75 });
  const normalized = mapper.canvasCssToNormalized(css);
  close(normalized.normalizedX, 0.25);
  close(normalized.normalizedY, 0.75);
});

test('normalized to backing pixels and back with devicePixelRatio 2', () => {
  const mapper = createCoordinateMapper({ workingWidth: 100, workingHeight: 100, viewportWidth: 200, viewportHeight: 200, devicePixelRatio: 2 });
  const pixel = mapper.normalizedToCanvasPixels({ normalizedX: 0.6, normalizedY: 0.4 });
  expect(pixel.canvasPixelX).toBeGreaterThan(0);
  const normalized = mapper.canvasPixelsToNormalized(pixel);
  close(normalized.normalizedX, 0.6);
  close(normalized.normalizedY, 0.4);
});

test('zoomed and panned mapping remains reversible', () => {
  const mapper = createCoordinateMapper({ workingWidth: 100, workingHeight: 200, viewportWidth: 400, viewportHeight: 400, zoom: 1.5, panX: 20, panY: -10 });
  const css = mapper.normalizedToCanvasCss({ normalizedX: 0.7, normalizedY: 0.2 });
  const normalized = mapper.canvasCssToNormalized(css);
  close(normalized.normalizedX, 0.7);
  close(normalized.normalizedY, 0.2);
});

test('90 degree rotation maps source through working and back', () => {
  const mapper = createCoordinateMapper({ sourceWidth: 100, sourceHeight: 200, workingWidth: 200, workingHeight: 100, rotation: 90 });
  const back = mapper.workingToSource(mapper.sourceToWorking({ sourceX: 10, sourceY: 150 }));
  close(back.sourceX, 10);
  close(back.sourceY, 150);
});

test('180 degree rotation maps source through working and back', () => {
  const mapper = createCoordinateMapper({ sourceWidth: 100, sourceHeight: 200, workingWidth: 100, workingHeight: 200, rotation: 180 });
  const back = mapper.workingToSource(mapper.sourceToWorking({ sourceX: 30, sourceY: 40 }));
  close(back.sourceX, 30);
  close(back.sourceY, 40);
});

test('270 degree rotation maps source through working and back', () => {
  const mapper = createCoordinateMapper({ sourceWidth: 100, sourceHeight: 200, workingWidth: 200, workingHeight: 100, rotation: 270 });
  const back = mapper.workingToSource(mapper.sourceToWorking({ sourceX: 75, sourceY: 20 }));
  close(back.sourceX, 75);
  close(back.sourceY, 20);
});

test('resized viewport keeps normalized coordinate reversible', () => {
  const mapper = createCoordinateMapper({ workingWidth: 320, workingHeight: 240, viewportWidth: 640, viewportHeight: 360 });
  const css = mapper.normalizedToCanvasCss({ normalizedX: 0.2, normalizedY: 0.8 });
  const normalized = mapper.canvasCssToNormalized(css);
  close(normalized.normalizedX, 0.2);
  close(normalized.normalizedY, 0.8);
});

test('object bounds convert normalized image coordinates to model coordinates', () => {
  const mapper = createCoordinateMapper({ objectBounds: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 }, centerlineX: 0.5, supportPlaneY: 0.9 });
  const model = mapper.normalizedImageToModel({ normalizedX: 0.6, normalizedY: 0.5 });
  close(model.modelX, 0.125);
  close(model.modelY, 0.5);
  const normalized = mapper.modelToNormalizedImage(model);
  close(normalized.normalizedX, 0.6);
  close(normalized.normalizedY, 0.5);
});
