/**
 * Turns routes into Cytoscape `segments` edge styles.
 *
 * With `edge-distances: endpoints` and manual `source-endpoint` /
 * `target-endpoint`, Cytoscape places segment point i at
 *   S + w_i * (T - S) + d_i * n,   n = (-(T-S).y, (T-S).x) / |T-S|
 * where S / T are the manual endpoints (start / end below). segmentStyleFor()
 * inverts exactly that: weight w_i and distance d_i of every segment point (the
 * route points between the endpoints).
 */

import type { Point } from '../shared/geometry';

/** The style bypass that makes Cytoscape draw an edge along a route. */
export interface EdgeSegmentStyle
{
  /** `round-segments` with a corner radius, `segments` without. */
  'curve-style': 'segments' | 'round-segments';
  /** Weights and distances are measured between the manual endpoints, not the node centres. */
  'edge-distances': 'endpoints';
  /** Where the line starts, relative to the source node's centre, e.g. `20px -15px`. */
  'source-endpoint': string;
  /** Where the line ends, relative to the target node's centre. */
  'target-endpoint': string;
  /** For each segment point: how far along the line from start to end it lies (0 to 1), space-separated. */
  'segment-weights': string;
  /** For each segment point: how far off that line it lies (px), space-separated. */
  'segment-distances': string;
  /** The corner radius (px), with `round-segments`. */
  'segment-radii'?: number;
  /** Corners are arcs of `segment-radii`. */
  'radius-type'?: 'arc-radius';
  /** Moves the label from where Cytoscape puts it, see `labelPosition`. */
  'text-margin-x'?: number;
  /** Moves the label from where Cytoscape puts it, see `labelPosition`. */
  'text-margin-y'?: number;
}

/** Every property {@link segmentStyleFor} may set, to remove them again. */
export const SEGMENT_STYLE_PROPERTIES: ReadonlyArray<keyof EdgeSegmentStyle> = [
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

/** How routes are drawn; the options of the same name of `cy.libavoid()`. */
export interface EdgeStyleOptions
{
  /** 0 = sharp corners, > 0 = rounded corners with this radius (px). */
  cornerRadius: number;
  /**
   * `'middle'`: where Cytoscape puts labels of segment edges, which on routes with an odd
   * number of bends is a corner. `'longest-segment'`: the centre of the longest segment,
   * a horizontal one if it is at least half as long; replaces `text-margin-x` / `-y`.
   */
  labelPosition: 'middle' | 'longest-segment';
}

/** Used for the options {@link segmentStyleFor} is not given. */
const DEFAULT_STYLE_OPTIONS: EdgeStyleOptions = { cornerRadius: 0, labelPosition: 'middle' };

/** Weights are fractions of the edge length, so they keep more digits than the route coordinates. */
const STYLE_PRECISION = 10000;
/** Routes whose start and end are closer than this (squared, px²) cannot be expressed as segments. */
const MIN_LENGTH_SQUARED = 1e-6;

/**
 * A number as text for a style value.
 *
 * @param value any number
 * @returns the number rounded to 1/{@link STYLE_PRECISION}, as text
 */
const formatNumber = (value: number): string => String(Math.round(value * STYLE_PRECISION) / STYLE_PRECISION);

/**
 * The `segments` style that makes Cytoscape draw an edge along `route`: the
 * endpoints become `source-endpoint` / `target-endpoint` relative to the node
 * centres, the points in between segment weights and distances (see the top of
 * this file). Only sets where the line runs (and, with the options, its corners
 * and label position); colour, width and arrows stay the stylesheet's.
 *
 * @param route        route points incl. both endpoints, in model coordinates
 * @param sourceCentre position of the source node
 * @param targetCentre position of the target node
 * @param options      corner radius and label position; missing ones use {@link DEFAULT_STYLE_OPTIONS}
 * @returns style bypass, or null if the route has fewer than two points or its start and end coincide
 */
export function segmentStyleFor(
  route: readonly Point[] | null | undefined,
  sourceCentre: Point,
  targetCentre: Point,
  options: Partial<EdgeStyleOptions> = {},
): EdgeSegmentStyle | null
{
  const { cornerRadius, labelPosition } = { ...DEFAULT_STYLE_OPTIONS, ...options };
  const start = route?.[0];
  const end = route?.[route.length - 1];
  if (!route || !start || !end || route.length < 2)
  {
    return null;
  }
  const along = { x: end.x - start.x, y: end.y - start.y };
  const lengthSquared = along.x * along.x + along.y * along.y;
  if (lengthSquared < MIN_LENGTH_SQUARED)
  {
    return null;
  }
  const length = Math.sqrt(lengthSquared);
  const normal = { x: -along.y / length, y: along.x / length };

  // Cytoscape needs at least one segment point; a straight route gets one in the middle
  const segmentPoints = route.length > 2 ?
    route.slice(1, -1) :
    [{ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }];
  const weights: string[] = [];
  const distances: string[] = [];
  for (const point of segmentPoints)
  {
    const fromStart = { x: point.x - start.x, y: point.y - start.y };
    weights.push(formatNumber((fromStart.x * along.x + fromStart.y * along.y) / lengthSquared));
    distances.push(formatNumber(fromStart.x * normal.x + fromStart.y * normal.y));
  }

  const style: EdgeSegmentStyle = {
    'curve-style': cornerRadius > 0 ? 'round-segments' : 'segments',
    'edge-distances': 'endpoints',
    'source-endpoint': `${formatNumber(start.x - sourceCentre.x)}px ${formatNumber(start.y - sourceCentre.y)}px`,
    'target-endpoint': `${formatNumber(end.x - targetCentre.x)}px ${formatNumber(end.y - targetCentre.y)}px`,
    'segment-weights': weights.join(' '),
    'segment-distances': distances.join(' '),
  };
  if (cornerRadius > 0)
  {
    style['segment-radii'] = cornerRadius;
    style['radius-type'] = 'arc-radius';
  }
  if (labelPosition === 'longest-segment')
  {
    const offset = labelOffset(route, segmentPoints);
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
 * @param points        the whole route, incl. both endpoints
 * @param segmentPoints the points between the endpoints, as Cytoscape places them
 * @returns the offset for `text-margin-x` / `-y`; (0, 0) if there is nothing to move
 */
export function labelOffset(points: readonly Point[], segmentPoints: readonly Point[]): Point
{
  const count = segmentPoints.length;
  const a = segmentPoints[Math.floor((count - 1) / 2)];
  const b = segmentPoints[Math.floor(count / 2)];
  if (!a || !b)
  {
    return { x: 0, y: 0 };
  }
  const cytoscapeLabelPoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

  let longest: [Point, Point] | undefined;
  let longestHorizontal: [Point, Point] | undefined;
  const lengthOf = (segment: [Point, Point] | undefined): number =>
    segment ? Math.hypot(segment[1].x - segment[0].x, segment[1].y - segment[0].y) : 0;
  for (let i = 1; i < points.length; i++)
  {
    const segment: [Point, Point] = [points[i - 1]!, points[i]!];
    if (lengthOf(segment) > lengthOf(longest))
    {
      longest = segment;
    }
    if (segment[0].y === segment[1].y && lengthOf(segment) > lengthOf(longestHorizontal))
    {
      longestHorizontal = segment;
    }
  }
  const chosen = lengthOf(longestHorizontal) >= lengthOf(longest) / 2 ? longestHorizontal : longest;
  if (!chosen)
  {
    return { x: 0, y: 0 };
  }
  const centre = { x: (chosen[0].x + chosen[1].x) / 2, y: (chosen[0].y + chosen[1].y) / 2 };
  return { x: centre.x - cytoscapeLabelPoint.x, y: centre.y - cytoscapeLabelPoint.y };
}
