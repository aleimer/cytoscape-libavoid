// Turns routes into Cytoscape `segments` edge styles and back; EdgeStyler
// (edge-styler.ts) applies them.
//
// With `edge-distances: endpoints` and manual `source-endpoint` /
// `target-endpoint`, Cytoscape places segment point i at
//   S + w_i * (T - S) + d_i * n,   n = (-(T-S).y, (T-S).x) / |T-S|
// where S / T are the manual endpoints (start / end below). routeToEdgeStyle()
// inverts exactly that: weight w_i and distance d_i of every inner route point.

import type { Point } from '../shared/geometry';

export interface EdgeSegmentStyle {
  'curve-style': 'segments' | 'round-segments';
  'edge-distances': 'endpoints';
  'source-endpoint': string;
  'target-endpoint': string;
  'segment-weights': string;
  'segment-distances': string;
  'segment-radii'?: number;
  'radius-type'?: 'arc-radius';
  /** Moves the label from where Cytoscape puts it, see `labelPosition`. */
  'text-margin-x'?: number;
  'text-margin-y'?: number;
}

export const STYLE_PROPS: ReadonlyArray<keyof EdgeSegmentStyle> = [
  'curve-style',
  'edge-distances',
  'source-endpoint',
  'target-endpoint',
  'segment-weights',
  'segment-distances',
  'segment-radii',
  'radius-type',
  'text-margin-x',
  'text-margin-y',
];

export interface EdgeStyleOptions {
  /** 0 = sharp corners, > 0 = rounded corners with this radius (px). */
  cornerRadius: number;
  /**
   * `'middle'`: where Cytoscape puts labels of segment edges, which on routes with an odd
   * number of bends is a corner. `'longest-segment'`: the centre of the longest segment,
   * a horizontal one if it is at least half as long; replaces `text-margin-x` / `-y`.
   */
  labelPosition: 'middle' | 'longest-segment';
}

const defaultStyleOptions: EdgeStyleOptions = { cornerRadius: 0, labelPosition: 'middle' };

/** Weights are fractions of the edge length, so they keep more digits than the route coordinates. */
const STYLE_PRECISION = 10000;
const MIN_LENGTH_SQUARED = 1e-6;

const format = (value: number): string => String(Math.round(value * STYLE_PRECISION) / STYLE_PRECISION);

/**
 * @param points        route incl. both endpoints
 * @param sourceCentre  position of the source node
 * @param targetCentre  position of the target node
 * @returns style bypass, or null if start and end of the route coincide
 */
export function routeToEdgeStyle(
  points: readonly Point[] | null | undefined,
  sourceCentre: Point,
  targetCentre: Point,
  options: Partial<EdgeStyleOptions> = {},
): EdgeSegmentStyle | null {
  const { cornerRadius, labelPosition } = { ...defaultStyleOptions, ...options };
  const start = points?.[0];
  const end = points?.[points.length - 1];
  if (!points || !start || !end || points.length < 2) return null;
  const along = { x: end.x - start.x, y: end.y - start.y };
  const lengthSquared = along.x * along.x + along.y * along.y;
  if (lengthSquared < MIN_LENGTH_SQUARED) return null;
  const length = Math.sqrt(lengthSquared);
  const normal = { x: -along.y / length, y: along.x / length };

  // Cytoscape needs at least one segment point; a straight route gets one in the middle
  const inner = points.length > 2 ? points.slice(1, -1) : [{ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }];
  const weights: string[] = [];
  const distances: string[] = [];
  for (const point of inner) {
    const fromStart = { x: point.x - start.x, y: point.y - start.y };
    weights.push(format((fromStart.x * along.x + fromStart.y * along.y) / lengthSquared));
    distances.push(format(fromStart.x * normal.x + fromStart.y * normal.y));
  }

  const style: EdgeSegmentStyle = {
    'curve-style': cornerRadius > 0 ? 'round-segments' : 'segments',
    'edge-distances': 'endpoints',
    'source-endpoint': `${format(start.x - sourceCentre.x)}px ${format(start.y - sourceCentre.y)}px`,
    'target-endpoint': `${format(end.x - targetCentre.x)}px ${format(end.y - targetCentre.y)}px`,
    'segment-weights': weights.join(' '),
    'segment-distances': distances.join(' '),
  };
  if (cornerRadius > 0) {
    style['segment-radii'] = cornerRadius;
    style['radius-type'] = 'arc-radius';
  }
  if (labelPosition === 'longest-segment') {
    const offset = labelOffset(points, inner);
    style['text-margin-x'] = Math.round(offset.x * 100) / 100;
    style['text-margin-y'] = Math.round(offset.y * 100) / 100;
  }
  return style;
}

/**
 * From where Cytoscape puts the label of a segment edge to the centre of the
 * route's longest segment (a horizontal one if it is at least half as long).
 * Cytoscape uses the middle segment point, or with an even number of them the
 * middle between the two middle ones (with rounded corners a point on the arc
 * near it, which is ignored here).
 *
 * @param segmentPoints the segment points Cytoscape gets, without the endpoints
 */
export function labelOffset(points: readonly Point[], segmentPoints: readonly Point[]): Point {
  const count = segmentPoints.length;
  const a = segmentPoints[Math.floor((count - 1) / 2)];
  const b = segmentPoints[Math.floor(count / 2)];
  if (!a || !b) return { x: 0, y: 0 };
  const cytoscapeMiddle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

  let longest: [Point, Point] | undefined;
  let longestHorizontal: [Point, Point] | undefined;
  const lengthOf = (segment: [Point, Point] | undefined): number =>
    segment ? Math.hypot(segment[1].x - segment[0].x, segment[1].y - segment[0].y) : 0;
  for (let i = 1; i < points.length; i++) {
    const segment: [Point, Point] = [points[i - 1]!, points[i]!];
    if (lengthOf(segment) > lengthOf(longest)) longest = segment;
    if (segment[0].y === segment[1].y && lengthOf(segment) > lengthOf(longestHorizontal)) longestHorizontal = segment;
  }
  const chosen = lengthOf(longestHorizontal) >= lengthOf(longest) / 2 ? longestHorizontal : longest;
  if (!chosen) return { x: 0, y: 0 };
  const centre = { x: (chosen[0].x + chosen[1].x) / 2, y: (chosen[0].y + chosen[1].y) / 2 };
  return { x: centre.x - cytoscapeMiddle.x, y: centre.y - cytoscapeMiddle.y };
}

/** Inverse of routeToEdgeStyle(): the absolute route points of a style. */
export function edgeStyleToPoints(
  style: Pick<EdgeSegmentStyle, 'source-endpoint' | 'target-endpoint' | 'segment-weights' | 'segment-distances'>,
  sourceCentre: Point,
  targetCentre: Point,
): Point[] {
  const numbers = (value: string): number[] => value.split(/\s+/).map(parseFloat);
  const [startX = 0, startY = 0] = numbers(style['source-endpoint']);
  const [endX = 0, endY = 0] = numbers(style['target-endpoint']);
  const start = { x: sourceCentre.x + startX, y: sourceCentre.y + startY };
  const end = { x: targetCentre.x + endX, y: targetCentre.y + endY };
  const along = { x: end.x - start.x, y: end.y - start.y };
  const length = Math.hypot(along.x, along.y);
  const normal = { x: -along.y / length, y: along.x / length };
  const distances = numbers(style['segment-distances']);
  const inner = numbers(style['segment-weights']).map((weight, i) => {
    const distance = distances[i] ?? 0;
    return { x: start.x + weight * along.x + distance * normal.x, y: start.y + weight * along.y + distance * normal.y };
  });
  return [start, ...inner, end];
}
