// Separates edges that libavoid leaves on top of each other. libavoid keeps a
// clearance (shapeBufferDistance) around nodes and does not nudge segments
// into it, so where many edges share a narrow gap between nodes it stacks
// them on the same line. Two helpers deal with that:
//
// - findDetours() finds gaps ("streets") that more edges use than fit into
//   them and picks checkpoints in wider streets for the edges that only pass
//   through; EdgeRouter routes again through them.
// - separateOverlaps() spreads the remaining overlapping segments apart by
//   their widths, using part of the clearance if necessary, but never
//   entering a node. Only inner segments move: the first and last segment of
//   a route are attached to their ports. Moving a vertical segment sideways
//   only stretches its horizontal neighbours (and vice versa), so routes stay
//   orthogonal.

import type { Point } from './libavoid';
import type { GraphModel, GraphNode } from './routing';

/** Distance kept between a moved stroke and a node border (px). */
const NODE_MARGIN = 2;
/** Shorter shared runs do not count as overlaps; they are just touching corners. */
const MIN_SHARED_RUN = 1;
const MAX_PASSES = 4;
/** A bundle that would have to be squeezed below this share of its ideal width stays as it is. */
const MIN_SQUEEZE = 0.15;

type Axis = 'x' | 'y';

/** An orthogonal segment of a route, between route[index] and route[index + 1]. */
interface Run {
  edgeId: string;
  route: Point[];
  index: number;
  /** The coordinate the segment can be moved along: x for a vertical segment, y for a horizontal one. */
  axis: Axis;
  width: number;
  /** False for the first and last segment: they are attached to their ports. */
  movable: boolean;
}

const other = (axis: Axis): Axis => (axis === 'x' ? 'y' : 'x');
const positionOf = (run: Run): number => run.route[run.index]![run.axis];

function extentOf(run: Run): [number, number] {
  const along = other(run.axis);
  const a = run.route[run.index]![along];
  const b = run.route[run.index + 1]![along];
  return a < b ? [a, b] : [b, a];
}

function runLength(run: Run): number {
  const [from, to] = extentOf(run);
  return to - from;
}

/** Length along which two parallel runs of different edges lie so close that their strokes touch. */
function overlapLength(a: Run, b: Run): number {
  if (a.axis !== b.axis || a.edgeId === b.edgeId) return 0;
  if (Math.abs(positionOf(a) - positionOf(b)) >= (a.width + b.width) / 2) return 0;
  const [a1, a2] = extentOf(a);
  const [b1, b2] = extentOf(b);
  const shared = Math.min(a2, b2) - Math.max(a1, b1);
  return shared > MIN_SHARED_RUN ? shared : 0;
}

/** A vertical and a horizontal run of different edges crossing in an X (not touching at an end). */
function cross(a: Run, b: Run): boolean {
  if (a.axis === b.axis || a.edgeId === b.edgeId) return false;
  const [aFrom, aTo] = extentOf(a);
  const [bFrom, bTo] = extentOf(b);
  return aFrom < positionOf(b) && positionOf(b) < aTo && bFrom < positionOf(a) && positionOf(a) < bTo;
}

/** The orthogonal segments of all routes as runs; the routes are used as they are, not copied. */
function runsOf(routes: ReadonlyMap<string, Point[]>, model: GraphModel): Run[] {
  const widths = new Map(model.edges.map((edge) => [edge.id, edge.width || 0]));
  const runs: Run[] = [];
  for (const [edgeId, route] of routes) {
    const width = widths.get(edgeId) ?? 0;
    for (let index = 0; index + 1 < route.length; index++) {
      const a = route[index]!;
      const b = route[index + 1]!;
      const axis = a.x === b.x ? 'x' : a.y === b.y ? 'y' : undefined;
      if (!axis) continue; // not orthogonal
      runs.push({ edgeId, route, index, axis, width, movable: index > 0 && index + 2 < route.length });
    }
  }
  return runs;
}

/**
 * Runs bucketed by axis and position, so the runs near a position are found
 * without comparing all pairs. Moving a run goes through the index.
 */
class RunIndex {
  /** The widest stroke: runs further apart than half of it plus half their own width cannot touch. */
  readonly maxWidth: number;
  private readonly bucketSize: number;
  private readonly buckets = new Map<string, Set<Run>>();

  constructor(runs: readonly Run[]) {
    this.maxWidth = runs.reduce((max, run) => Math.max(max, run.width), 0);
    this.bucketSize = this.maxWidth + 1;
    for (const run of runs) this.add(run);
  }

  /** Runs on `axis` positioned between `low` and `high` (and a few just outside). */
  between(axis: Axis, low: number, high: number): Run[] {
    const found: Run[] = [];
    for (let bucket = Math.floor(low / this.bucketSize); bucket <= Math.floor(high / this.bucketSize); bucket++) {
      for (const run of this.buckets.get(`${axis}${bucket}`) ?? []) found.push(run);
    }
    return found;
  }

  /** Runs that overlap the given one. */
  overlapping(run: Run): Run[] {
    const reach = (run.width + this.maxWidth) / 2;
    const position = positionOf(run);
    return this.between(run.axis, position - reach, position + reach).filter((near) => overlapLength(run, near) > 0);
  }

  /** Sets both points of a run on its axis; the neighbouring segments stretch accordingly. */
  move(run: Run, position: number): void {
    this.remove(run);
    run.route[run.index] = { ...run.route[run.index]!, [run.axis]: position };
    run.route[run.index + 1] = { ...run.route[run.index + 1]!, [run.axis]: position };
    this.add(run);
  }

  private key(run: Run): string {
    return `${run.axis}${Math.floor(positionOf(run) / this.bucketSize)}`;
  }

  private add(run: Run): void {
    const key = this.key(run);
    let bucket = this.buckets.get(key);
    if (!bucket) this.buckets.set(key, (bucket = new Set()));
    bucket.add(run);
  }

  private remove(run: Run): void {
    this.buckets.get(this.key(run))?.delete(run);
  }
}

/** Groups of runs that overlap each other, directly or through other runs of the group. */
function overlappingBundles(runs: readonly Run[], index: RunIndex): Run[][] {
  const bundleOf = new Map<Run, Run[]>();
  const bundles: Run[][] = [];
  for (const start of runs) {
    if (bundleOf.has(start)) continue;
    const bundle = [start];
    bundleOf.set(start, bundle);
    for (let i = 0; i < bundle.length; i++) {
      for (const near of index.overlapping(bundle[i]!)) {
        if (bundleOf.has(near)) continue;
        bundleOf.set(near, bundle);
        bundle.push(near);
      }
    }
    if (bundle.length > 1) bundles.push(bundle);
  }
  return bundles;
}

// --- quality ---------------------------------------------------------------------

export interface RouteQuality {
  /** Length along which strokes of different edges lie on top of each other (px). */
  overlap: number;
  /** Crossings of segments of different edges. */
  crossings: number;
  /** Total route length (px). */
  length: number;
}

/** Measures orthogonal routes, to compare different routings of the same model. */
export function routeQuality(routes: ReadonlyMap<string, readonly Point[]>, model: GraphModel): RouteQuality {
  const runs = runsOf(copyRoutes(routes), model);
  const index = new RunIndex(runs);
  let overlap = 0;
  let crossings = 0;
  let length = 0;
  for (const run of runs) {
    length += runLength(run);
    for (const near of index.overlapping(run)) overlap += overlapLength(run, near) / 2; // each pair is seen twice
    if (run.axis === 'x') {
      const [from, to] = extentOf(run);
      for (const horizontal of index.between('y', from, to)) if (cross(run, horizontal)) crossings++;
    }
  }
  return { overlap, crossings, length };
}

// --- separation ------------------------------------------------------------------

/**
 * Spreads apart parallel segments of different edges whose strokes overlap.
 * Orthogonal routes only; other segments are left as they are.
 *
 * @param spacing gap kept between neighbouring strokes (px)
 * @returns new routes; the input is not changed
 */
export function separateOverlaps(
  routes: ReadonlyMap<string, readonly Point[]>,
  model: GraphModel,
  spacing: number,
): Map<string, Point[]> {
  const result = copyRoutes(routes);
  const runs = runsOf(result, model);
  const index = new RunIndex(runs);
  const runsByRoute = new Map<Point[], Run[]>();
  for (const run of runs) runsByRoute.set(run.route, [...(runsByRoute.get(run.route) ?? []), run]);

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let improved = false;
    for (const bundle of overlappingBundles(runs, index)) {
      if (!bundle.some((run) => run.movable)) continue;
      if (separateBundle(bundle, index, runsByRoute, spacing, model.nodes)) improved = true;
    }
    if (!improved) break;
  }

  for (const route of result.values()) {
    for (let i = 0; i < route.length; i++) route[i] = { x: round(route[i]!.x), y: round(route[i]!.y) };
  }
  return result;
}

const round = (value: number): number => Math.round(value * 1000) / 1000;

function copyRoutes(routes: ReadonlyMap<string, readonly Point[]>): Map<string, Point[]> {
  const copy = new Map<string, Point[]>();
  for (const [edgeId, points] of routes)
    copy.set(
      edgeId,
      points.map((point) => ({ ...point })),
    );
  return copy;
}

/** Moves a bundle apart if that reduces the overlaps around it; returns whether it moved. */
function separateBundle(
  bundle: Run[],
  index: RunIndex,
  runsByRoute: ReadonlyMap<Point[], Run[]>,
  spacing: number,
  nodes: readonly GraphNode[],
): boolean {
  bundle.sort(compareInBundle);
  const positions = spread(bundle, spacing, nodes);
  if (!positions) return false;

  // the bundle and the segments it stretches
  const affected = new Set<Run>(bundle);
  for (const run of bundle) {
    for (const neighbour of runsByRoute.get(run.route) ?? []) {
      if (Math.abs(neighbour.index - run.index) === 1) affected.add(neighbour);
    }
  }
  const overlapsAround = (): number => {
    let total = 0;
    for (const run of affected) for (const near of index.overlapping(run)) total += overlapLength(run, near);
    return total;
  };

  const before = overlapsAround();
  const previous = bundle.map(positionOf);
  bundle.forEach((run, i) => {
    if (run.movable) index.move(run, positions[i]!);
  });
  if (overlapsAround() < before - MIN_SHARED_RUN) return true;
  bundle.forEach((run, i) => {
    if (run.movable) index.move(run, previous[i]!);
  });
  return false;
}

/**
 * Order of the runs of a bundle across the axis. Runs keep libavoid's order;
 * runs on the same line are ordered by where their neighbours go, so a run
 * whose neighbours lead towards lower coordinates comes first.
 */
function compareInBundle(a: Run, b: Run): number {
  const lean = (run: Run): number => {
    const position = positionOf(run);
    const before = run.route[run.index - 1]?.[run.axis] ?? position;
    const after = run.route[run.index + 2]?.[run.axis] ?? position;
    return Math.sign(before - position) + Math.sign(after - position);
  };
  return positionOf(a) - positionOf(b) || lean(a) - lean(b) || a.edgeId.localeCompare(b.edgeId);
}

/** New positions for a bundle, spread by width and spacing and kept inside every run's free interval. */
function spread(bundle: Run[], spacing: number, nodes: readonly GraphNode[]): number[] | undefined {
  const offsets = [0];
  for (let i = 1; i < bundle.length; i++) {
    offsets.push(offsets[i - 1]! + (bundle[i - 1]!.width + bundle[i]!.width) / 2 + spacing);
  }
  const span = offsets[offsets.length - 1]!;
  const centre = bundle.reduce((sum, run) => sum + positionOf(run), 0) / bundle.length;
  const intervals = bundle.map((run) => freeInterval(run, nodes));

  // the full spread if it fits, otherwise squeezed as little as possible
  for (let squeeze = 1; squeeze >= MIN_SQUEEZE; squeeze -= 0.1) {
    const wanted = offsets.map((offset) => centre + (offset - span / 2) * squeeze);
    let shiftLow = -Infinity;
    let shiftHigh = Infinity;
    intervals.forEach(([low, high], i) => {
      shiftLow = Math.max(shiftLow, low - wanted[i]!);
      shiftHigh = Math.min(shiftHigh, high - wanted[i]!);
    });
    if (shiftLow <= shiftHigh) {
      const shift = Math.min(shiftHigh, Math.max(shiftLow, 0));
      return wanted.map((position) => position + shift);
    }
  }
  return undefined;
}

/**
 * Where a run may be placed along its axis without entering a node, without
 * reversing its neighbouring segments and without passing the ones beyond them.
 * Fixed runs stay where they are.
 */
function freeInterval(run: Run, nodes: readonly GraphNode[]): [number, number] {
  const { axis, route, index } = run;
  const along = other(axis);
  const position = positionOf(run);
  if (!run.movable) return [position, position];
  const [from, to] = extentOf(run);
  let low = -Infinity;
  let high = Infinity;

  // the neighbours keep their direction: route[index - 1] and route[index + 2] stay on their side
  for (const neighbour of [route[index - 1]!, route[index + 2]!]) {
    const value = neighbour[axis];
    if (value < position) low = Math.max(low, value + 1);
    else if (value > position) high = Math.min(high, value - 1);
    else return [position, position];
  }

  const clearance = run.width / 2 + NODE_MARGIN;
  for (const node of nodes) {
    const half = { x: node.width / 2, y: node.height / 2 };
    const centre = { x: node.x, y: node.y };
    // nodes beside the run's extent, incl. its end points where the neighbours run along the node
    if (centre[along] + half[along] + clearance <= from || centre[along] - half[along] - clearance >= to) continue;
    const nodeLow = centre[axis] - half[axis] - clearance;
    const nodeHigh = centre[axis] + half[axis] + clearance;
    if (nodeHigh <= position) low = Math.max(low, nodeHigh);
    else if (nodeLow >= position) high = Math.min(high, nodeLow);
    else return [position, position]; // already closer than the margin: leave it
  }
  return [low, high];
}

// --- detours ---------------------------------------------------------------------

export interface DetourOptions {
  /** Gap kept between neighbouring strokes (px). */
  spacing: number;
  /** libavoid's shapeBufferDistance; the detour street keeps it to the nodes. */
  clearance: number;
  /**
   * Only streets between the two ends of the route. With docking ports a detour
   * against the edge's direction becomes a loop around its node.
   */
  onTheWay: boolean;
  /**
   * At most this many detours, the runs passing through over the longest distance first:
   * every checkpoint makes the second libavoid run slower.
   */
  maxDetours: number;
}

/**
 * Finds streets (gaps between nodes) that more parallel edges use than fit
 * into them. The runs that stay in such a street are the short, local ones;
 * for each of the others it picks a point in the nearest street that is free
 * of nodes over the run's whole length and clearly wider. Routing again with
 * these points as checkpoints moves the edges there.
 *
 * @returns edge id -> checkpoint
 */
export function findDetours(
  routes: ReadonlyMap<string, readonly Point[]>,
  model: GraphModel,
  options: DetourOptions,
): Map<string, Point> {
  const runs = runsOf(copyRoutes(routes), model);
  const index = new RunIndex(runs);

  // the runs that do not fit into their street, with the room it has
  const evicted: Array<{ run: Run; room: number }> = [];
  for (const bundle of overlappingBundles(runs, index)) {
    const movable = bundle.filter((run) => run.movable);
    if (movable.length === 0) continue;
    const intervals = movable.map((run) => freeInterval(run, model.nodes));
    const room = Math.min(...intervals.map(([, high]) => high)) - Math.max(...intervals.map(([low]) => low));
    if (!Number.isFinite(room)) continue;
    let used = 0;
    for (const run of [...movable].sort((a, b) => runLength(a) - runLength(b))) {
      const needed = run.width + options.spacing;
      if (used + needed <= room) used += needed;
      else evicted.push({ run, room });
    }
  }

  const detours = new Map<string, Point>();
  const sentToStreet = new Map<string, number>();
  evicted.sort((a, b) => runLength(b.run) - runLength(a.run));
  for (const { run, room } of evicted) {
    if (detours.size >= options.maxDetours) break;
    if (detours.has(run.edgeId)) continue;
    const street = nearestWideStreet(run, model.nodes, room, options);
    if (!street) continue;
    // detours into the same street are lined up from its side facing the crowded one
    const key = `${run.axis}:${street.low}:${street.high}`;
    const count = sentToStreet.get(key) ?? 0;
    sentToStreet.set(key, count + 1);
    const step = run.width + options.spacing;
    const centre = (street.low + street.high) / 2;
    const position =
      street.low > positionOf(run)
        ? Math.min(centre, street.low + (count + 1) * step)
        : Math.max(centre, street.high - (count + 1) * step);
    const [from, to] = extentOf(run);
    const middle = (from + to) / 2;
    detours.set(run.edgeId, run.axis === 'x' ? { x: position, y: middle } : { x: middle, y: position });
  }
  return detours;
}

/**
 * The nearest gap between nodes, along the run's axis, that is free over the
 * run's whole extent (keeping the clearance to the nodes) and at least twice
 * as wide as the crowded one. Outside the outermost nodes there is always room.
 */
function nearestWideStreet(
  run: Run,
  nodes: readonly GraphNode[],
  crowdedRoom: number,
  options: DetourOptions,
): { low: number; high: number } | undefined {
  const { axis } = run;
  const along = other(axis);
  const [from, to] = extentOf(run);
  const { clearance } = options;
  const blocked: Array<[number, number]> = [];
  for (const node of nodes) {
    const half = { x: node.width / 2, y: node.height / 2 };
    const centre = { x: node.x, y: node.y };
    if (centre[along] + half[along] + clearance <= from || centre[along] - half[along] - clearance >= to) continue;
    blocked.push([centre[axis] - half[axis] - clearance, centre[axis] + half[axis] + clearance]);
  }
  blocked.sort((a, b) => a[0] - b[0]);

  const streets: Array<{ low: number; high: number }> = [];
  let low = -Infinity;
  for (const [start, end] of blocked) {
    if (start > low) streets.push({ low, high: start });
    low = Math.max(low, end);
  }
  streets.push({ low, high: Infinity });

  const position = positionOf(run);
  const minWidth = Math.max(2 * crowdedRoom, 4 * (run.width + 1));
  const start = run.route[0]![axis];
  const end = run.route[run.route.length - 1]![axis];
  const way = options.onTheWay ? [Math.min(start, end), Math.max(start, end)] : [-Infinity, Infinity];
  // the outer areas are unbounded: give them a finite far side
  const outerWidth = 10 * (run.width + 1);
  let best: { low: number; high: number } | undefined;
  let bestDistance = Infinity;
  for (const candidate of streets) {
    let street = { low: Math.max(candidate.low, way[0]!), high: Math.min(candidate.high, way[1]!) };
    if (street.high - street.low < minWidth) continue;
    if (street.low <= position && position <= street.high) continue; // the crowded street itself
    if (!Number.isFinite(street.low)) street = { low: street.high - outerWidth, high: street.high };
    if (!Number.isFinite(street.high)) street = { low: street.low, high: street.low + outerWidth };
    const distance = position < street.low ? street.low - position : position - street.high;
    if (distance < bestDistance) {
      best = street;
      bestDistance = distance;
    }
  }
  return best;
}
