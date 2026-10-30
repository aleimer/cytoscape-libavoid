/**
 * Puts the thickest edge in the middle of a node side that more than two edges
 * attach to, whether they start or end there. libavoid fans the edges out along
 * the side in the order of their directions, so the middle goes to whichever
 * edge runs straight ahead; this step reorders the fan so the thickest edge
 * attaches at the side's centre, the others keep their order around it. Where
 * that would add crossings, e.g. a thin edge pushed across a thick edge turning
 * towards it, the thickest still goes to the centre with more of the others on
 * one side of it, if that adds none; otherwise the side keeps libavoid's fan.
 *
 * libavoid often puts the bends of an edge turning up and one turning down on
 * the same line, since they do not touch. Once the fan is reordered they can lie
 * on top of each other for a few pixels next to the node; EdgeRouter separates
 * overlaps again after this step.
 *
 * "End" below means either end of an edge: its start at the source or its end
 * at the target.
 */

import { otherAxis } from '../shared/geometry';
import type { Point, Side } from '../shared/geometry';
import type { RouteGeometry } from './route-geometry';
import type { Segment, SegmentEnd } from './segment';

/** Sides with fewer edges keep libavoid's fan. */
const MIN_ENDS = 3;
/**
 * A fan that does not fit on the side is squeezed in steps of 1/SQUEEZE_STEPS
 * of its gaps, down to MIN_SQUEEZE_STEPS of them; below that the side stays as it is.
 */
const SQUEEZE_STEPS = 10;
const MIN_SQUEEZE_STEPS = 2;

/** One edge end on a node side, start or target end: the end segment and which of its ends it is. */
interface SideEnd
{
  segment: Segment;
  end: SegmentEnd;
}

/**
 * Reorders the edges on every node side that at least MIN_ENDS of them start or
 * end at, so the thickest attaches at the centre of the side; changes `geometry`
 * in place. Sides whose ends are not fanned out, where even the squeezed fan
 * does not fit or where every slot for the thickest adds crossings stay as they are. Separate overlaps afterwards, see the top of the file.
 *
 * @param spacing gap kept between neighbouring strokes (px)
 */
export function centreThickestEdgesIn(geometry: RouteGeometry, spacing: number): void
{
  const segmentsByRoute = new Map<Point[], Segment[]>();
  for (const segment of geometry.segments)
  {
    segmentsByRoute.set(segment.route, [...(segmentsByRoute.get(segment.route) ?? []), segment]);
  }
  for (const ends of endsBySide(geometry).values())
  {
    if (ends.length >= MIN_ENDS)
    {
      centreThickest(geometry, ends, spacing, segmentsByRoute);
    }
  }
}

/** The end segments of all routes, grouped by node side ("nodeId side"). */
function endsBySide(geometry: RouteGeometry): Map<string, SideEnd[]>
{
  const bySide = new Map<string, SideEnd[]>();
  for (const segment of geometry.segments)
  {
    for (const end of segment.ends)
    {
      if (!segment.sideInterval(end))
      {
        continue; // not on a side across the segment
      }
      const key = `${end.node.id} ${sideOf(segment, end)}`;
      bySide.set(key, [...(bySide.get(key) ?? []), { segment, end }]);
    }
  }
  return bySide;
}

/** The side of its node an end segment ends at: a vertical segment ends at the top or bottom. */
function sideOf(segment: Segment, { node, point }: SegmentEnd): Side
{
  const end = segment.route[point]!;
  return segment.axis === 'x' ? (end.y < node.y ? 'top' : 'bottom') : end.x < node.x ? 'left' : 'right';
}

/**
 * Moves the ends of one side so the thickest is at the centre, squeezed as little
 * as needed to fit, in the slot of the fan nearest its middle that adds no crossings.
 */
function centreThickest(
  geometry: RouteGeometry,
  ends: SideEnd[],
  spacing: number,
  segmentsByRoute: ReadonlyMap<Point[], Segment[]>,
): void
{
  if (ends.some(({ segment }) => !segment.movable))
  {
    return;
  }
  const fan = ends.map(({ segment }) => segment).sort((a, b) => a.position - b.position);
  if (fan[0]!.position === fan[fan.length - 1]!.position)
  {
    return; // not fanned out, see nudgeConnectedSegments
  }
  const centre = ends[0]!.end.node[fan[0]!.axis];
  const thickest = [...fan].sort(
    (a, b) =>
      b.width - a.width ||
      Math.abs(a.position - centre) - Math.abs(b.position - centre) ||
      a.edgeId.localeCompare(b.edgeId),
  )[0]!;

  // the others keep their order; the thickest goes to the middle slot, on the side it came from
  const from = fan.indexOf(thickest);
  const middle = from < (fan.length - 1) / 2 ? Math.floor((fan.length - 1) / 2) : Math.ceil((fan.length - 1) / 2);
  const others = fan.filter((segment) => segment !== thickest);
  /**
   * where the middle slot adds crossings, one further out may not: the others then
   * lie more on one side, e.g. away from the direction the thickest turns to
   */
  const slots = fan
    .map((_, slot) => slot)
    .sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle) || Math.abs(a - from) - Math.abs(b - from));

  // moving an end segment stretches the next one of its route, which may then cross other edges
  const affected = new Set(fan);
  for (const segment of fan)
  {
    for (const next of segmentsByRoute.get(segment.route) ?? [])
    {
      if (Math.abs(next.index - segment.index) === 1)
      {
        affected.add(next);
      }
    }
  }
  const crossingsBefore = crossingsOf(geometry, affected);
  const previous = fan.map((segment) => segment.position);
  const gaps = fan.slice(1).map((segment, i) => segment.position - fan[i]!.position);

  for (const slot of slots)
  {
    const order = [...others];
    order.splice(slot, 0, thickest);
    const positions = fittingFan(geometry, order, gaps, slot, centre, spacing);
    if (!positions)
    {
      continue;
    }
    order.forEach((segment, i) => geometry.move(segment, positions[i]!));
    if (crossingsOf(geometry, affected) <= crossingsBefore)
    {
      return;
    }
    fan.forEach((segment, i) => geometry.move(segment, previous[i]!));
  }
}

/**
 * Positions for the segments in `order` with slot `slot` at `centre`: libavoid's
 * `gaps` where they are wide enough, otherwise the widths plus spacing; the full
 * fan if it fits in the free intervals, otherwise squeezed as little as possible,
 * undefined if even the most squeezed one does not fit.
 */
function fittingFan(
  geometry: RouteGeometry,
  order: readonly Segment[],
  gaps: readonly number[],
  slot: number,
  centre: number,
  spacing: number,
): number[] | undefined
{
  const pitches = order.slice(1).map((segment, i) =>
  {
    const needed = (order[i]!.width + segment.width) / 2 + spacing;
    return Math.max(gaps[i]!, needed);
  });
  const freeIntervals = order.map((segment) => geometry.freeInterval(segment));
  for (let steps = SQUEEZE_STEPS; steps >= MIN_SQUEEZE_STEPS; steps--)
  {
    const positions = fanPositions(pitches, slot, centre, steps / SQUEEZE_STEPS);
    if (freeIntervals.every(([low, high], i) => low <= positions[i]! && positions[i]! <= high))
    {
      return positions;
    }
  }
  return undefined;
}

/** How often these segments cross segments of other edges. */
function crossingsOf(geometry: RouteGeometry, segments: ReadonlySet<Segment>): number
{
  let crossings = 0;
  for (const segment of segments)
  {
    const [from, to] = segment.span;
    for (const across of geometry.between(otherAxis(segment.axis), from, to))
    {
      if (segment.crosses(across))
      {
        crossings++;
      }
    }
  }
  return crossings;
}

/** Positions of a fan with these gaps between neighbours, scaled by `squeeze`, with slot `middle` at `centre`. */
function fanPositions(pitches: readonly number[], middle: number, centre: number, squeeze: number): number[]
{
  const offsets = [0];
  for (const pitch of pitches)
  {
    offsets.push(offsets[offsets.length - 1]! + pitch * squeeze);
  }
  return offsets.map((offset) => centre + offset - offsets[middle]!);
}
