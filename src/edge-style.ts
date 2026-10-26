// Turns routes into Cytoscape `segments` edge styles and applies them.
//
// With `edge-distances: endpoints` and manual `source-endpoint` /
// `target-endpoint`, Cytoscape places segment point i at
//   S + w_i * (T - S) + d_i * n,   n = (-(T-S).y, (T-S).x) / |T-S|
// where S / T are the manual endpoints (start / end below). routeToEdgeStyle()
// inverts exactly that: weight w_i and distance d_i of every inner route point.

import type { Core } from 'cytoscape';
import type { Point } from './libavoid';

export interface EdgeSegmentStyle {
  'curve-style': 'segments' | 'round-segments';
  'edge-distances': 'endpoints';
  'source-endpoint': string;
  'target-endpoint': string;
  'segment-weights': string;
  'segment-distances': string;
  'segment-radii'?: number;
  'radius-type'?: 'arc-radius';
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
];

/** Weights are fractions of the edge length, so they keep more digits than the route coordinates. */
const STYLE_PRECISION = 10000;
const MIN_LENGTH_SQUARED = 1e-6;

const format = (value: number): string => String(Math.round(value * STYLE_PRECISION) / STYLE_PRECISION);

/**
 * @param points        route incl. both endpoints
 * @param sourceCentre  position of the source node
 * @param targetCentre  position of the target node
 * @param cornerRadius  0 = sharp corners, > 0 = rounded corners
 * @returns style bypass, or null if start and end of the route coincide
 */
export function routeToEdgeStyle(
  points: readonly Point[] | null | undefined,
  sourceCentre: Point,
  targetCentre: Point,
  cornerRadius = 0,
): EdgeSegmentStyle | null {
  if (!points || points.length < 2) return null;
  const start = points[0];
  const end = points[points.length - 1];
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
  return style;
}

/** Inverse of routeToEdgeStyle(): the absolute route points of a style. */
export function edgeStyleToPoints(
  style: Pick<EdgeSegmentStyle, 'source-endpoint' | 'target-endpoint' | 'segment-weights' | 'segment-distances'>,
  sourceCentre: Point,
  targetCentre: Point,
): Point[] {
  const numbers = (value: string): number[] => value.split(/\s+/).map(parseFloat);
  const [startX, startY] = numbers(style['source-endpoint']);
  const [endX, endY] = numbers(style['target-endpoint']);
  const start = { x: sourceCentre.x + startX, y: sourceCentre.y + startY };
  const end = { x: targetCentre.x + endX, y: targetCentre.y + endY };
  const along = { x: end.x - start.x, y: end.y - start.y };
  const length = Math.hypot(along.x, along.y);
  const normal = { x: -along.y / length, y: along.x / length };
  const distances = numbers(style['segment-distances']);
  const inner = numbers(style['segment-weights']).map((weight, i) => ({
    x: start.x + weight * along.x + distances[i] * normal.x,
    y: start.y + weight * along.y + distances[i] * normal.y,
  }));
  return [start, ...inner, end];
}

/** Applies routes to Cytoscape edges as style bypasses, and removes them again. */
export class EdgeStyler {
  private readonly cy: Core;
  /** Edge id -> element and style last applied to it, to skip edges whose route did not change. */
  private readonly applied = new Map<string, { element: unknown; styleKey: string }>();

  constructor(cy: Core) {
    this.cy = cy;
  }

  /**
   * Styles every routed edge and restores the edges that are no longer routed.
   *
   * @param nodePositions positions of the nodes when the routes were computed. The
   *   edge ends are anchored relative to them, so routes that arrive late (from a
   *   worker) still start and end at their nodes if those moved in the meantime.
   *   Missing nodes use their current position.
   */
  apply(
    routes: ReadonlyMap<string, readonly Point[]>,
    cornerRadius: number,
    nodePositions: ReadonlyMap<string, Point> = new Map(),
  ): void {
    this.cy.batch(() => {
      for (const edgeId of [...this.applied.keys()]) {
        if (!routes.has(edgeId)) this.restore(edgeId);
      }
      for (const [edgeId, points] of routes) this.applyRoute(edgeId, points, cornerRadius, nodePositions);
    });
  }

  /** Restores the stylesheet style of every edge styled so far. */
  clear(): void {
    this.cy.batch(() => {
      for (const edgeId of [...this.applied.keys()]) this.restore(edgeId);
    });
  }

  private applyRoute(
    edgeId: string,
    points: readonly Point[],
    cornerRadius: number,
    nodePositions: ReadonlyMap<string, Point>,
  ): void {
    const edge = this.cy.getElementById(edgeId);
    if (!edge.isEdge()) return; // removed since the routes were computed
    const source = edge.source();
    const target = edge.target();
    const sourceCentre = nodePositions.get(source.id()) ?? source.position();
    const targetCentre = nodePositions.get(target.id()) ?? target.position();
    const style = routeToEdgeStyle(points, sourceCentre, targetCentre, cornerRadius);
    if (!style) return;
    // every style update is costly and, with compound nodes, fires 'style' on all nodes
    const styleKey = JSON.stringify(style);
    const previous = this.applied.get(edgeId);
    if (previous && previous.element === edge[0] && previous.styleKey === styleKey) return;
    if (!style['segment-radii']) edge.removeStyle('segment-radii radius-type'); // left over from a rounded style
    edge.style(style);
    this.applied.set(edgeId, { element: edge[0], styleKey });
  }

  private restore(edgeId: string): void {
    const edge = this.cy.getElementById(edgeId);
    if (edge.nonempty()) edge.removeStyle(STYLE_PROPS.join(' '));
    this.applied.delete(edgeId);
  }
}
