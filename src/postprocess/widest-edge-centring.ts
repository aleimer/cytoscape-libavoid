/**
 * Puts the widest edge in the centre of a node side that more than two edges
 * attach to, whether they start or end there. libavoid fans the edges out along
 * the side in the order of their directions, so the middle goes to whichever
 * edge runs straight ahead; this step reorders the fan so the widest edge
 * attaches at the side's centre, the others keep their order around it. Where
 * that would add crossings, e.g. a thin edge pushed across a wide edge turning
 * towards it, the widest still goes to the centre with more of the others on
 * one side of it, if that adds none; otherwise the side keeps libavoid's fan.
 * The same goes for overlaps, e.g. a thin edge between two nodes packed around
 * the widest edge of one node's side reaching into a wider one at the other.
 *
 * libavoid often puts the bends of an edge turning up and one turning down on
 * the same line, since they do not touch. Once the fan is reordered they can lie
 * on top of each other for a few pixels next to the node, so separate overlaps
 * again after this step.
 *
 * "End" below means either end of an edge: its start at the source or its end
 * at the target.
 */

import { otherAxis } from '../shared/geometry';
import type { Side } from '../shared/geometry';
import type { RouteGeometry } from './route-geometry';
import type { Segment, SegmentEnd } from './segment';

/** Sides with fewer edges keep libavoid's fan. */
const MIN_ENDS = 3;
/**
 * A fan that does not fit on the side is squeezed in steps of 1/SQUEEZE_STEPS
 * of its pitches, down to {@link MIN_SQUEEZE_STEPS} of them; below that the full fan is
 * shifted off the centre as little as needed to fit, see {@link shiftedFan}.
 */
const SQUEEZE_STEPS = 10;
/** The most squeezed a fan gets, in steps of 1/{@link SQUEEZE_STEPS}. */
const MIN_SQUEEZE_STEPS = 2;

/** One edge end on a node side, start or target end: the end segment and which of its ends it is. */
interface SideEnd
{
  /** The first or last segment of the route. */
  segment: Segment;
  /** Which of its ends lies on the side. */
  end: SegmentEnd;
}

/**
 * Reorders the edges on every node side that at least {@link MIN_ENDS} of them start
 * or end at, so the widest attaches at the centre of the side. Sides stay as they
 * are where the ends are not fanned out, where no fan fits, not even squeezed or
 * shifted, or where every slot for the widest adds crossings or overlap. Separate
 * overlaps afterwards, see the top of the file.
 *
 * @param geometry the routes; changed in place
 * @param spacing  gap kept between neighbouring strokes (px)
 */
export function centreWidestEdges(geometry: RouteGeometry, spacing: number): void
{
  for (const ends of endsBySide(geometry).values())
  {
    if (ends.length >= MIN_ENDS)
    {
      centreWidest(geometry, ends, spacing);
    }
  }
}

/**
 * The end segments of all routes, grouped by the node side they end on.
 *
 * @param geometry the routes
 * @returns `"nodeId side"` -> the ends on that side; ends not on a side across their segment are left out
 */
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

/**
 * The side of its node an end segment ends at.
 *
 * @param segment an end segment
 * @param end     one of its {@link Segment.ends}
 * @returns top or bottom for a vertical segment, left or right for a horizontal one
 */
function sideOf(segment: Segment, { node, pointIndex }: SegmentEnd): Side
{
  const end = segment.route[pointIndex]!;
  return segment.positionAxis === 'x' ? (end.y < node.y ? 'top' : 'bottom') : end.x < node.x ? 'left' : 'right';
}

/**
 * Moves the ends of one side so the widest is at the centre, squeezed as little
 * as needed to fit, in the slot of the fan nearest its middle that adds neither
 * crossings nor overlap. If no slot does, the side stays as it was.
 *
 * @param geometry the routes; changed in place
 * @param ends     the ends on one node side, at least {@link MIN_ENDS}
 * @param spacing  gap kept between neighbouring strokes (px)
 */
function centreWidest(geometry: RouteGeometry, ends: SideEnd[], spacing: number): void
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
  const centre = ends[0]!.end.node[fan[0]!.positionAxis];
  const widest = [...fan].sort(
    (a, b) =>
      b.width - a.width ||
      Math.abs(a.position - centre) - Math.abs(b.position - centre) ||
      a.edgeId.localeCompare(b.edgeId),
  )[0]!;

  // the others keep their order; the widest goes to the middle slot, on the side it came from
  const originalSlot = fan.indexOf(widest);
  const middleSlot = originalSlot < (fan.length - 1) / 2 ?
    Math.floor((fan.length - 1) / 2) :
    Math.ceil((fan.length - 1) / 2);
  const others = fan.filter((segment) => segment !== widest);
  /**
   * where the middle slot adds crossings, one further out may not: the others then
   * lie more on one side, e.g. away from the direction the widest turns to
   */
  const slots = fan
    .map((_, slot) => slot)
    .sort((a, b) =>
      Math.abs(a - middleSlot) - Math.abs(b - middleSlot) || Math.abs(a - originalSlot) - Math.abs(b - originalSlot)
    );

  // moving an end segment stretches the next one of its route, which may then cross other edges
  const affected = geometry.withRouteNeighbours(fan);
  const crossingsBefore = crossingsOf(geometry, affected);
  const overlapBefore = geometry.overlapLengthOf(fan);
  const previous = fan.map((segment) => segment.position);

  // where no fan fits with the widest at the centre, one shifted towards the room there is
  for (const fanOf of [fittingFan, shiftedFan])
  {
    for (const slot of slots)
    {
      const order = [...others];
      order.splice(slot, 0, widest);
      const packed = fanOf(geometry, order, slot, centre, spacing);
      if (!packed)
      {
        continue;
      }
      const loose = loosenedFan(order, slot, packed);
      for (const positions of fits(geometry, order, loose) ? [packed, loose] : [packed])
      {
        order.forEach((segment, i) => geometry.move(segment, positions[i]!));
        if (crossingsOf(geometry, affected) <= crossingsBefore && geometry.overlapLengthOf(fan) <= overlapBefore)
        {
          return;
        }
        fan.forEach((segment, i) => geometry.move(segment, previous[i]!));
      }
    }
  }
}

/**
 * The full packed fan with one slot at the centre, shifted as little as needed
 * to fit in the free intervals, e.g. away from the node the inner edges of the
 * fan turn into.
 *
 * @param geometry for the free intervals
 * @param order    the segments in their new order across the side
 * @param slot     the index in `order` that goes to `centre`
 * @param centre   the centre of the side on the segments' axis
 * @param spacing  gap kept between neighbouring strokes (px)
 * @returns a position for each segment of `order`, or undefined if the fan does not fit anywhere
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
    const [freeLow, freeHigh] = geometry.freeInterval(segment);
    low = Math.max(low, freeLow - positions[i]!);
    high = Math.min(high, freeHigh - positions[i]!);
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
 * a side of each; packed around this side's widest edge it may reach into a
 * wider one at the other node, where it is already packed.
 *
 * @param order  the segments in their new order across the side
 * @param slot   the index of the widest in `order`; it keeps its packed position
 * @param packed the packed position of each, see {@link fittingFan} and {@link shiftedFan}
 * @returns a position for each segment of `order`, never closer to the centre than packed
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

/**
 * Whether segments may move to new positions.
 *
 * @param geometry  for the free intervals
 * @param order     the segments
 * @param positions a position for each, in the same order
 * @returns true if every position lies within its segment's {@link RouteGeometry.freeInterval}
 */
function fits(geometry: RouteGeometry, order: readonly Segment[], positions: readonly number[]): boolean
{
  return order.every((segment, i) =>
  {
    const [low, high] = geometry.freeInterval(segment);
    return low <= positions[i]! && positions[i]! <= high;
  });
}

/**
 * The fan packed around one slot at the centre: neighbouring strokes `spacing`
 * apart. libavoid's gaps would spread the fan over the whole side and leave the
 * widest far from the others once it moved.
 *
 * @param geometry for the free intervals
 * @param order    the segments in their new order across the side
 * @param slot     the index in `order` that goes to `centre`
 * @param centre   the centre of the side on the segments' axis
 * @param spacing  gap kept between neighbouring strokes (px)
 * @returns a position for each segment of `order`: the full fan if it fits, otherwise
 *   squeezed as little as possible; undefined if even the most squeezed one does not fit
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

/**
 * How often segments cross segments of other edges.
 *
 * @param geometry the routes
 * @param segments the segments to count for
 * @returns the number of crossings; a crossing between two of `segments` counts twice
 */
function crossingsOf(geometry: RouteGeometry, segments: ReadonlySet<Segment>): number
{
  let crossings = 0;
  for (const segment of segments)
  {
    const [from, to] = segment.span;
    for (const across of geometry.segmentsBetween(otherAxis(segment.positionAxis), from, to))
    {
      if (segment.crosses(across))
      {
        crossings++;
      }
    }
  }
  return crossings;
}

/**
 * Distances between neighbouring segments of a packed fan: their strokes `spacing` apart.
 *
 * @param order   the segments in their order across the side
 * @param spacing gap kept between neighbouring strokes (px)
 * @returns one distance less than there are segments
 */
function pitchesOf(order: readonly Segment[], spacing: number): number[]
{
  return order.slice(1).map((segment, i) => (order[i]!.width + segment.width) / 2 + spacing);
}

/**
 * Positions of a fan around one slot.
 *
 * @param pitches the distances between neighbours, see {@link pitchesOf}
 * @param slot    the index that goes to `centre`
 * @param centre  where that slot goes
 * @param squeeze factor for the pitches, 1 = full fan
 * @returns one position per slot, from low to high
 */
function fanPositions(pitches: readonly number[], slot: number, centre: number, squeeze: number): number[]
{
  const offsets = [0];
  for (const pitch of pitches)
  {
    offsets.push(offsets[offsets.length - 1]! + pitch * squeeze);
  }
  return offsets.map((offset) => centre + offset - offsets[slot]!);
}
