/** Spreads apart parallel segments that lie on top of each other, see route-geometry.ts. */

import type { Point } from '../shared/geometry';
import type { GraphModel } from '../shared/graph';
import { RouteGeometry } from './route-geometry';
import { MIN_SHARED_LENGTH } from './segment';
import type { Segment } from './segment';

/** At most this many rounds over all bundles; moving one bundle can create new overlaps. */
const MAX_PASSES = 4;
/**
 * A bundle that does not fit is squeezed in steps of 1/SQUEEZE_STEPS of its ideal
 * width, down to {@link MIN_SQUEEZE_STEPS} of them; below that it stays as it is.
 */
const SQUEEZE_STEPS = 10;
/** The most squeezed a bundle gets, in steps of 1/{@link SQUEEZE_STEPS}. */
const MIN_SQUEEZE_STEPS = 2;

/**
 * Spreads apart parallel segments of different edges whose strokes overlap.
 * Orthogonal routes only; other segments are left as they are.
 *
 * @param geometry the routes; changed in place
 * @param spacing  gap kept between neighbouring strokes (px)
 */
export function separateOverlaps(geometry: RouteGeometry, spacing: number): void
{
  new OverlapSeparator(geometry, spacing).separate();
}

/**
 * {@link separateOverlaps} for plain routes.
 *
 * @param routes  edge id -> route points; not changed
 * @param model   the graph the routes belong to, for edge widths and nodes
 * @param spacing gap kept between neighbouring strokes (px)
 * @returns separated copies of the routes
 */
export function separatedRoutes(
  routes: ReadonlyMap<string, readonly Point[]>,
  model: GraphModel,
  spacing: number,
): Map<string, Point[]>
{
  const geometry = new RouteGeometry(routes, model);
  separateOverlaps(geometry, spacing);
  return geometry.routes;
}

/** The work behind {@link separateOverlaps}. */
class OverlapSeparator
{
  /** The routes to change. */
  private readonly geometry: RouteGeometry;
  /** Gap kept between neighbouring strokes (px). */
  private readonly spacing: number;

  /**
   * @param geometry the routes to change
   * @param spacing  gap kept between neighbouring strokes (px)
   */
  constructor(geometry: RouteGeometry, spacing: number)
  {
    this.geometry = geometry;
    this.spacing = spacing;
  }

  /**
   * Moves every overlapping bundle apart where that reduces the overlaps, in up to
   * {@link MAX_PASSES} passes until one changes nothing. Changes the geometry in place.
   */
  separate(): void
  {
    for (let pass = 0; pass < MAX_PASSES; pass++)
    {
      let improved = false;
      for (const bundle of this.geometry.overlappingBundles())
      {
        if (!bundle.some((segment) => segment.movable))
        {
          continue;
        }
        if (this.separateBundle(bundle))
        {
          improved = true;
        }
      }
      if (!improved)
      {
        break;
      }
    }
  }

  /**
   * Moves a bundle apart if that reduces the overlaps around it, and back if not.
   *
   * @param bundle overlapping segments, see {@link RouteGeometry.overlappingBundles}; sorted in place
   * @returns true if the bundle moved
   */
  private separateBundle(bundle: Segment[]): boolean
  {
    bundle.sort(compareInBundle);
    const positions = this.spreadPositions(bundle);
    if (!positions)
    {
      return false;
    }
    const affected = this.geometry.withRouteNeighbours(bundle);
    const before = this.geometry.overlapLengthOf(affected);
    const previous = bundle.map((segment) => segment.position);
    this.moveBundle(bundle, positions);
    // a gain shorter than touching corners does not count
    if (this.geometry.overlapLengthOf(affected) < before - MIN_SHARED_LENGTH)
    {
      return true;
    }
    this.moveBundle(bundle, previous);
    return false;
  }

  /**
   * Moves the movable segments of a bundle; fixed ones stay.
   *
   * @param bundle    the segments
   * @param positions a new position for each, in the same order
   */
  private moveBundle(bundle: Segment[], positions: number[]): void
  {
    bundle.forEach((segment, i) =>
    {
      if (segment.movable)
      {
        this.geometry.move(segment, positions[i]!);
      }
    });
  }

  /**
   * New positions for a bundle, spread by width and spacing around its current
   * centre and kept inside every segment's free interval. Calculates only; nothing moves.
   *
   * @param bundle the segments, in their order across the axis
   * @returns a position for each, squeezed as little as possible; undefined if even
   *   the most squeezed spread does not fit
   */
  private spreadPositions(bundle: Segment[]): number[] | undefined
  {
    const offsets = [0];
    for (let i = 1; i < bundle.length; i++)
    {
      offsets.push(offsets[i - 1]! + (bundle[i - 1]!.width + bundle[i]!.width) / 2 + this.spacing);
    }
    const span = offsets[offsets.length - 1]!;
    const centre = bundle.reduce((sum, segment) => sum + segment.position, 0) / bundle.length;
    const intervals = bundle.map((segment) => this.geometry.freeInterval(segment));

    // the full spread if it fits, otherwise squeezed as little as possible
    for (let steps = SQUEEZE_STEPS; steps >= MIN_SQUEEZE_STEPS; steps--)
    {
      const squeeze = steps / SQUEEZE_STEPS;
      const wanted = offsets.map((offset) => centre + (offset - span / 2) * squeeze);
      let shiftLow = -Infinity;
      let shiftHigh = Infinity;
      intervals.forEach(([low, high], i) =>
      {
        shiftLow = Math.max(shiftLow, low - wanted[i]!);
        shiftHigh = Math.min(shiftHigh, high - wanted[i]!);
      });
      if (shiftLow <= shiftHigh)
      {
        const shift = Math.min(shiftHigh, Math.max(shiftLow, 0));
        return wanted.map((position) => position + shift);
      }
    }
    return undefined;
  }
}

/**
 * Order of the segments of a bundle across the axis. Segments keep libavoid's order;
 * segments on the same line are ordered by where their neighbours go, so a segment
 * whose neighbours lead towards lower coordinates comes first.
 *
 * @param a a segment of the bundle
 * @param b another one
 * @returns negative if `a` comes first, positive if `b` does; ties are broken by edge id
 */
function compareInBundle(a: Segment, b: Segment): number
{
  // -2 … 2: where the segment's neighbours lead, relative to its position
  const lean = (segment: Segment): number =>
  {
    const { position } = segment;
    const before = segment.route[segment.startIndex - 1]?.[segment.positionAxis] ?? position;
    const after = segment.route[segment.startIndex + 2]?.[segment.positionAxis] ?? position;
    return Math.sign(before - position) + Math.sign(after - position);
  };
  return a.position - b.position || lean(a) - lean(b) || a.edgeId.localeCompare(b.edgeId);
}
