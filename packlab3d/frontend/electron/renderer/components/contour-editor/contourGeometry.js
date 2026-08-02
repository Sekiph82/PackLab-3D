export function defaultContour(photo = {}) {
  const width = Math.max(Number(photo.quality?.metrics?.objectCoverage || 0.58), 0.38);
  const left = 0.5 - width / 2;
  const right = 0.5 + width / 2;
  return {
    revision: photo.geometry?.revisions?.activeContour || 0,
    source: 'fallback',
    points: [
      { id: `${photo.id || 'photo'}-c-0`, x: left, y: 0.1, locked: false, source: 'fallback' },
      { id: `${photo.id || 'photo'}-c-1`, x: right, y: 0.1, locked: false, source: 'fallback' },
      { id: `${photo.id || 'photo'}-c-2`, x: right, y: 0.9, locked: false, source: 'fallback' },
      { id: `${photo.id || 'photo'}-c-3`, x: left, y: 0.9, locked: false, source: 'fallback' },
    ],
    holes: [],
  };
}

export function normalizeContour(contour, photo = {}) {
  const source = contour?.active || contour?.manual || contour?.automatic || contour || defaultContour(photo);
  const points = (source.points || source.editablePoints || source.normalizedContour?.points || [])
    .map((point, index) => ({
      id: point.id || `${photo.id || 'photo'}-contour-${index}`,
      x: clamp(Number(point.x ?? point.normalizedX ?? 0.5)),
      y: clamp(Number(point.y ?? point.normalizedY ?? 0.5)),
      locked: Boolean(point.locked),
      source: point.source || source.source || 'automatic',
    }));
  return {
    revision: Number(source.revision ?? contour?.revision ?? photo.geometry?.revisions?.activeContour ?? 0),
    source: source.source || contour?.source || 'automatic',
    points: points.length >= 3 ? points : defaultContour(photo).points,
    holes: source.holes || [],
    checksum: source.checksum || contour?.checksum || '',
  };
}

export function validateContourPoints(points) {
  const errors = [];
  if (!Array.isArray(points) || points.length < 3) errors.push('A closed contour requires at least 3 points.');
  const clean = points || [];
  for (const point of clean) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) errors.push('Contour contains non-finite coordinates.');
    if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) errors.push('Contour points must remain inside the normalized image.');
  }
  for (let index = 0; index < clean.length; index += 1) {
    const a = clean[index];
    const b = clean[(index + 1) % clean.length];
    if (distance(a, b) < 0.001) errors.push('Contour contains a collapsed segment.');
  }
  if (Math.abs(polygonArea(clean)) < 0.0005) errors.push('Contour area is too small.');
  if (hasSelfIntersection(clean)) errors.push('Contour self-intersects.');
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export function polygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

export function nearestSegment(points, target) {
  let best = { index: -1, distance: Infinity };
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const distanceValue = pointSegmentDistance(target, a, b);
    if (distanceValue < best.distance) best = { index, distance: distanceValue };
  }
  return best;
}

export function smoothPoints(points, selectedIds, strength = 0.35) {
  const selected = new Set(selectedIds || []);
  return points.map((point, index) => {
    if (!selected.has(point.id) || point.locked) return point;
    const prev = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    return {
      ...point,
      x: clamp(point.x * (1 - strength) + ((prev.x + next.x) / 2) * strength),
      y: clamp(point.y * (1 - strength) + ((prev.y + next.y) / 2) * strength),
      source: 'manual',
    };
  });
}

export function simplifyPoints(points, selectedIds, tolerance = 0.018) {
  const selected = new Set(selectedIds || []);
  const kept = points.filter((point, index) => {
    if (point.locked || selected.has(point.id)) return true;
    const prev = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    return pointSegmentDistance(point, prev, next) > tolerance || points.length <= 8;
  });
  return kept.length >= 3 ? kept : points;
}

function hasSelfIntersection(points) {
  for (let i = 0; i < points.length; i += 1) {
    const a1 = points[i];
    const a2 = points[(i + 1) % points.length];
    for (let j = i + 1; j < points.length; j += 1) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === points.length - 1)) continue;
      const b1 = points[j];
      const b2 = points[(j + 1) % points.length];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function orientation(a, b, c) {
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

function pointSegmentDistance(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  return distance(point, { x: a.x + t * dx, y: a.y + t * dy });
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}
