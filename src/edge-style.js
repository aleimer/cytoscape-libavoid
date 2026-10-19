// Converts an absolute route polyline into Cytoscape `segments` edge styles.
//
// With `edge-distances: endpoints` and manual `source-endpoint` /
// `target-endpoint`, Cytoscape places segment point i at
//   S + w_i * (T - S) + d_i * n,   n = (-(T-S).y, (T-S).x) / |T-S|
// where S/T are the manual endpoints. We invert exactly that.

export const STYLE_PROPS = [
  'curve-style',
  'edge-distances',
  'source-endpoint',
  'target-endpoint',
  'segment-weights',
  'segment-distances',
  'segment-radii',
  'radius-type',
];

const fmt = (v) => String(Math.round(v * 10000) / 10000);

/**
 * @param {Array<{x,y}>} points  route incl. both endpoints
 * @param {{x,y}} srcPos         source node position (centre)
 * @param {{x,y}} tgtPos         target node position (centre)
 * @param {number} cornerRadius  0 = sharp taxi corners, > 0 = rounded corners
 * @returns {object|null} style bypass object, or null if the route is degenerate
 */
export function routeToEdgeStyle(points, srcPos, tgtPos, cornerRadius = 0) {
  if (!points || points.length < 2) return null;
  const S = points[0];
  const T = points[points.length - 1];
  const dx = T.x - S.x;
  const dy = T.y - S.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-6) return null;
  const l = Math.sqrt(l2);
  const nx = -dy / l;
  const ny = dx / l;

  let inner = points.slice(1, -1);
  if (inner.length === 0) inner = [{ x: (S.x + T.x) / 2, y: (S.y + T.y) / 2 }];

  const weights = [];
  const distances = [];
  for (const p of inner) {
    const px = p.x - S.x;
    const py = p.y - S.y;
    weights.push(fmt((px * dx + py * dy) / l2));
    distances.push(fmt(px * nx + py * ny));
  }

  const style = {
    'curve-style': cornerRadius > 0 ? 'round-segments' : 'segments',
    'edge-distances': 'endpoints',
    'source-endpoint': `${fmt(S.x - srcPos.x)}px ${fmt(S.y - srcPos.y)}px`,
    'target-endpoint': `${fmt(T.x - tgtPos.x)}px ${fmt(T.y - tgtPos.y)}px`,
    'segment-weights': weights.join(' '),
    'segment-distances': distances.join(' '),
  };
  if (cornerRadius > 0) {
    style['segment-radii'] = cornerRadius;
    style['radius-type'] = 'arc-radius';
  }
  return style;
}

/** Inverse of routeToEdgeStyle (used by tests): reconstructs absolute points. */
export function edgeStyleToPoints(style, srcPos, tgtPos) {
  const parse = (s) => s.split(/\s+/).map(parseFloat);
  const [sx, sy] = parse(style['source-endpoint']);
  const [tx, ty] = parse(style['target-endpoint']);
  const S = { x: srcPos.x + sx, y: srcPos.y + sy };
  const T = { x: tgtPos.x + tx, y: tgtPos.y + ty };
  const dx = T.x - S.x;
  const dy = T.y - S.y;
  const l = Math.hypot(dx, dy);
  const ws = parse(style['segment-weights']);
  const ds = parse(style['segment-distances']);
  const mid = ws.map((w, i) => ({ x: S.x + w * dx + (-dy / l) * ds[i], y: S.y + w * dy + (dx / l) * ds[i] }));
  return [S, ...mid, T];
}
