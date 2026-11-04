/**
 * Puts the thickest edge in the middle of a node side that more than two edges
 * attach to, whether they start or end there. libavoid fans the edges out along
 * the side in the order of their directions, so the middle goes to whichever
 * edge runs straight ahead; this step reorders the fan so the thickest edge
 * attaches at the side's centre, the others keep their order around it. Where
 * that would add crossings, e.g. a thin edge pushed across a thick edge turning
 * towards it, the thickest still goes to the centre with more of the others on
 * one side of it, if that adds none; otherwise the side keeps libavoid's fan.
 * The same goes for overlaps, e.g. a thin edge between two nodes packed around
 * the thickest edge of one node's side reaching into a thicker one at the other.
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
 * of its pitches, down to MIN_SQUEEZE_STEPS of them; below that the full fan is
 * shifted off the centre as little as needed to fit, see shiftedFan().
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
 * in place. Sides whose ends are not fanned out, where no fan fits, not even
 * squeezed or shifted, or where every slot for the thickest adds crossings stay as they are. Separate overlaps afterwards, see the top of the file.
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
  const overlapBefore = overlapOf(geometry, fan);
  const previous = fan.map((segment) => segment.position);

  // where no fan fits with the thickest at the centre, one shifted towards the room there is
  for (const fanOf of [fittingFan, shiftedFan])
  {
    for (const slot of slots)
    {
      const order = [...others];
      order.splice(slot, 0, thickest);
      const packed = fanOf(geometry, order, slot, centre, spacing);
      if (!packed)
      {
        continue;
      }
      const loose = loosenedFan(order, slot, packed);
      for (const positions of fits(geometry, order, loose) ? [packed, loose] : [packed])
      {
        order.forEach((segment, i) => geometry.move(segment, positions[i]!));
        if (crossingsOf(geometry, affected) <= crossingsBefore && overlapOf(geometry, fan) <= overlapBefore)
        {
          return;
        }
        fan.forEach((segment, i) => geometry.move(segment, previous[i]!));
      }
    }
  }
}

/**
 * The full packed fan with slot `slot` at `centre`, shifted as little as needed
 * to fit in the free intervals, e.g. away from the node the inner edges of the
 * fan turn into; undefined if it does not fit anywhere.
 */
function shiftedFan(
  geometry: RouteGeometry,
  order: readonly Segment[],
  slot: number,
  centre: number,
  spacing: number,
): number[] | undefined
{
  const positions = fanPositions(pitchesOf(order, spacing), slot, centre, 1);
  let low = -Infinity;
  let high = Infinity;
  order.forEach((segment, i) =>
  {
    const [free, to] = geometry.freeInterval(segment);
    low = Math.max(low, free - positions[i]!);
    high = Math.min(high, to - positions[i]!);
  });
  if (low > high)
  {
    return undefined;
  }
  const shift = Math.min(Math.max(0, low), high);
  return positions.map((position) => position + shift);
}

/**
 * The packed fan, but segments already further out than their packed position
 * stay there, and so do the ones beyond them. A segment between two nodes is on
 * a side of each; packed around this side's thickest edge it may reach into a
 * thicker one at the other node, where it is already packed.
 */
function loosenedFan(order: readonly Segment[], slot: number, packed: readonly number[]): number[]
{
  const loose = [...packed];
  for (let i = slot + 1; i < order.length; i++)
  {
    loose[i] = Math.max(loose[i - 1]! + packed[i]! - packed[i - 1]!, order[i]!.position);
  }
  for (let i = slot - 1; i >= 0; i--)
  {
    loose[i] = Math.min(loose[i + 1]! - (packed[i + 1]! - packed[i]!), order[i]!.position);
  }
  return loose;
}

/** True if every segment of `order` may move to its position. */
function fits(geometry: RouteGeometry, order: readonly Segment[], positions: readonly number[]): boolean
{
  return order.every((segment, i) =>
  {
    const [low, high] = geometry.freeInterval(segment);
    return low <= positions[i]! && positions[i]! <= high;
  });
}

/**
 * Positions for the segments in `order` with slot `slot` at `centre`, packed:
 * neighbouring strokes `spacing` apart. libavoid's gaps would spread the fan over
 * the whole side and leave the thickest far from the others once it moved. The
 * full fan if it fits in the free intervals, otherwise squeezed as little as
 * possible, undefined if even the most squeezed one does not fit.
 */
function fittingFan(
  geometry: RouteGeometry,
  order: readonly Segment[],
  slot: number,
  centre: number,
  spacing: number,
): number[] | undefined
{
  const pitches = pitchesOf(order, spacing);
  for (let steps = SQUEEZE_STEPS; steps >= MIN_SQUEEZE_STEPS; steps--)
  {
    const positions = fanPositions(pitches, slot, centre, steps / SQUEEZE_STEPS);
    if (fits(geometry, order, positions))
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

/** Distances between neighbouring segments of a packed fan: their strokes `spacing` apart. */
function pitchesOf(order: readonly Segment[], spacing: number): number[]
{
  return order.slice(1).map((segment, i) => (order[i]!.width + segment.width) / 2 + spacing);
}

/** Length along which these segments overlap segments of other edges. */
function overlapOf(geometry: RouteGeometry, segments: readonly Segment[]): number
{
  let overlap = 0;
  for (const segment of segments)
  {
    for (const near of geometry.overlapping(segment))
    {
      overlap += segment.overlapLength(near);
    }
  }
  return overlap;
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
