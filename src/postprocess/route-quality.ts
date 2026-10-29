// Measures routes, to compare different routings of the same model.

import type { Point } from '../shared/geometry';
import type { GraphModel } from '../shared/graph';
import { RouteGeometry } from './route-geometry';

export interface RouteQuality {
  /** Length along which strokes of different edges lie on top of each other (px). */
  overlap: number;
  /** Crossings of segments of different edges. */
  crossings: number;
  /** Total route length (px). */
  length: number;
}

/** Overlaps, crossings and length of the orthogonal routes of a geometry. */
export function measureQuality(geometry: RouteGeometry): RouteQuality {
  let overlap = 0;
  let crossings = 0;
  let length = 0;
  for (const run of geometry.runs) {
    length += run.length;
    for (const near of geometry.overlapping(run)) overlap += run.overlapLength(near) / 2; // each pair is seen twice
    if (run.axis === 'x') {
      const [from, to] = run.extent;
      for (const horizontal of geometry.between('y', from, to)) if (run.crosses(horizontal)) crossings++;
    }
  }
  return { overlap, crossings, length };
}

/** measureQuality() for plain routes. */
export function routeQuality(routes: ReadonlyMap<string, readonly Point[]>, model: GraphModel): RouteQuality {
  return measureQuality(new RouteGeometry(routes, model));
}
