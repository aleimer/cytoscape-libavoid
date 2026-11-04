/** Measures routes, to compare different routings of the same model. */

import type { Point } from '../shared/geometry';
import type { GraphModel } from '../shared/graph';
import { RouteGeometry } from './route-geometry';

/** How good a set of routes is: less of each is better. */
export interface RouteQuality
{
  /** Length along which strokes of different edges lie on top of each other (px). */
  overlapLength: number;
  /** Crossings of segments of different edges. */
  crossings: number;
  /** Total route length (px). */
  length: number;
}

/**
 * Measures the orthogonal routes of a geometry.
 *
 * @param geometry the routes to measure; they are not changed
 * @returns their overlaps, crossings and length
 */
export function measureGeometry(geometry: RouteGeometry): RouteQuality
{
  let overlapLength = 0;
  let crossings = 0;
  let length = 0;
  for (const segment of geometry.segments)
  {
    length += segment.length;
    for (const near of geometry.overlapping(segment))
    {
      overlapLength += segment.overlapLength(near) / 2; // each pair is seen twice
    }
    if (segment.positionAxis === 'x')
    {
      const [from, to] = segment.span;
      for (const horizontal of geometry.segmentsBetween('y', from, to))
      {
        if (segment.crosses(horizontal))
        {
          crossings++;
        }
      }
    }
  }
  return { overlapLength, crossings, length };
}

/**
 * {@link measureGeometry} for plain routes.
 *
 * @param routes edge id -> route points
 * @param model  the graph the routes belong to, for edge widths and nodes
 * @returns their overlaps, crossings and length
 */
export function measureRoutes(routes: ReadonlyMap<string, readonly Point[]>, model: GraphModel): RouteQuality
{
  return measureGeometry(new RouteGeometry(routes, model));
}
