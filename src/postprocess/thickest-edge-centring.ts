// Puts the thickest edge in the middle of a node side that more than two edges
// attach to, whether they start or end there. libavoid fans the edges out along
// the side in the order of their directions, so the middle goes to whichever
// edge runs straight ahead; this step reorders the fan so the thickest edge
// attaches at the side's centre, the others keep their order around it. That
// may add crossings next to the node.
//
// "End" below means either end of an edge: its start at the source or its end
// at the target.

import type { Point, Side } from '../shared/geometry';
import type { RouteGeometry } from './route-geometry';
import { MIN_SHARED_LENGTH } from './segment';
import type { Segment, SegmentEnd } from './segment';

/** Sides with fewer edges keep libavoid's fan. */
const MIN_ENDS = 3;

/** One edge end on a node side, start or target end: the end segment and which of its ends it is. */
interface SideEnd {
  segment: Segment;
  end: SegmentEnd;
}

/**
 * Reorders the edges on every node side that at least MIN_ENDS of them start or
 * end at, so the thickest attaches at the centre of the side; changes `geometry` in place.
 * Sides whose ends are not fanned out, where the new fan does not fit or where it
 * would make strokes overlap stay as they are.
 *
 * @param spacing gap kept between neighbouring strokes (px)
 */
export function centreThickestEdgesIn(geometry: RouteGeometry, spacing: number): void {
  const segmentsByRoute = new Map<Point[], Segment[]>();
  for (const segment of geometry.segments) {
    segmentsByRoute.set(segment.route, [...(segmentsByRoute.get(segment.route) ?? []), segment]);
  }
  for (const ends of endsBySide(geometry).values()) {
    if (ends.length >= MIN_ENDS) centreThickest(geometry, ends, spacing, segmentsByRoute);
  }
}

/** The end segments of all routes, grouped by node side ("nodeId side"). */
function endsBySide(geometry: RouteGeometry): Map<string, SideEnd[]> {
  const bySide = new Map<string, SideEnd[]>();
  for (const segment of geometry.segments) {
    for (const end of segment.ends) {
      if (!segment.sideInterval(end)) continue; // not on a side across the segment
      const key = `${end.node.id} ${sideOf(segment, end)}`;
      bySide.set(key, [...(bySide.get(key) ?? []), { segment, end }]);
    }
  }
  return bySide;
}

/** The side of its node an end segment ends at: a vertical segment ends at the top or bottom. */
function sideOf(segment: Segment, { node, point }: SegmentEnd): Side {
  const end = segment.route[point]!;
  return segment.axis === 'x' ? (end.y < node.y ? 'top' : 'bottom') : end.x < node.x ? 'left' : 'right';
}

/** Moves the ends of one side so the thickest is at the centre, if the new fan fits and overlaps no more. */
function centreThickest(
  geometry: RouteGeometry,
  ends: SideEnd[],
  spacing: number,
  segmentsByRoute: ReadonlyMap<Point[], Segment[]>,
): void {
  if (ends.some(({ segment }) => !segment.movable)) return;
  const fan = ends.map(({ segment }) => segment).sort((a, b) => a.position - b.position);
  if (fan[0]!.position === fan[fan.length - 1]!.position) return; // not fanned out, see nudgeConnectedSegments
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
  const order = fan.filter((segment) => segment !== thickest);
  order.splice(middle, 0, thickest);

  // libavoid's gaps where they are wide enough, otherwise the widths plus spacing
  const gaps = fan.slice(1).map((segment, i) => segment.position - fan[i]!.position);
  const offsets = [0];
  for (let i = 1; i < order.length; i++) {
    const needed = (order[i - 1]!.width + order[i]!.width) / 2 + spacing;
    offsets.push(offsets[i - 1]! + Math.max(gaps[i - 1]!, needed));
  }
  const positions = offsets.map((offset) => centre + offset - offsets[middle]!);
  if (order.every((segment, i) => segment.position === positions[i])) return;

  const fits = order.every((segment, i) => {
    const [low, high] = geometry.freeInterval(segment);
    return low <= positions[i]! && positions[i]! <= high;
  });
  if (!fits) return;

  // moving an end segment stretches the next one of its route, which may then lie on another edge
  const affected = new Set(order);
  for (const segment of order) {
    for (const next of segmentsByRoute.get(segment.route) ?? []) {
      if (Math.abs(next.index - segment.index) === 1) affected.add(next);
    }
  }
  const before = overlapsOf(geometry, affected);
  const previous = order.map((segment) => segment.position);
  order.forEach((segment, i) => geometry.move(segment, positions[i]!));
  if (overlapsOf(geometry, affected) > before + MIN_SHARED_LENGTH) {
    order.forEach((segment, i) => geometry.move(segment, previous[i]!));
  }
}

/** Total length along which these segments overlap others. */
function overlapsOf(geometry: RouteGeometry, segments: ReadonlySet<Segment>): number {
  let total = 0;
  for (const segment of segments) {
    for (const near of geometry.overlapping(segment)) total += segment.overlapLength(near);
  }
  return total;
}
