/** Cleans up the points libavoid returns. */

import type { Point } from '../shared/geometry';

/** libavoid returns float noise such as 12.000000001; coordinates are rounded to 1/1000 px. */
const COORDINATE_PRECISION = 1000;
/** A point this close to the line through its neighbours lies on it. */
const COLLINEAR_TOLERANCE = 1e-6;

/**
 * Rounds a coordinate to 1/{@link COORDINATE_PRECISION} px. SegmentIndex also rounds
 * the positions it moves segments to with it, so moved and unmoved points compare equal.
 *
 * @param value an x or y coordinate
 * @returns the rounded coordinate
 */
export const roundCoordinate = (value: number): number =>
  Math.round(value * COORDINATE_PRECISION) / COORDINATE_PRECISION;

/**
 * Rounds away float noise and drops duplicate points and points that lie on a
 * straight segment between its ends.
 *
 * @param points a route as libavoid returns it
 * @returns a new route with only its end points and bends
 */
export function simplify(points: readonly Point[]): Point[]
{
  const result: Point[] = [];
  for (const { x, y } of points)
  {
    const point = { x: roundCoordinate(x), y: roundCoordinate(y) };
    const last = result[result.length - 1];
    if (last && last.x === point.x && last.y === point.y)
    {
      continue;
    }
    const beforeLast = result[result.length - 2];
    if (last && beforeLast && continuesStraight(beforeLast, last, point))
    {
      result[result.length - 1] = point;
      continue;
    }
    result.push(point);
  }
  return result;
}

/**
 * Whether a path goes straight through its middle point.
 *
 * @param a the point before
 * @param b the point to test
 * @param c the point after
 * @returns true if `b` lies on the straight line from `a` to `c` and the path does not turn back at `b`
 */
function continuesStraight(a: Point, b: Point, c: Point): boolean
{
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const sameDirection = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= 0;
  return Math.abs(cross) < COLLINEAR_TOLERANCE && sameDirection;
}
