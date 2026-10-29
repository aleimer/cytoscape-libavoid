// Finds detours for edges that do not fit into a crowded gap, see route-geometry.ts.

import { extentOf } from '../shared/geometry';
import type { Point } from '../shared/geometry';
import type { GraphModel } from '../shared/graph';
import { RouteGeometry } from './route-geometry';
import type { Run } from './run';

/** A detour street is at least this many times as wide as the crowded one... */
const MIN_WIDENING = 2;
/** ...and has room for at least this many strokes of the run. */
const MIN_STREET_STROKES = 4;
/** The unbounded areas outside the outermost nodes count as this many strokes wide. */
const OUTER_STREET_STROKES = 10;

export interface DetourOptions {
  /** Gap kept between neighbouring strokes (px). */
  spacing: number;
  /** libavoid's shapeBufferDistance; the detour street keeps it to the nodes. */
  clearance: number;
  /**
   * At most this many detours, the runs passing through over the longest distance first:
   * every checkpoint makes the second libavoid run slower.
   */
  maxDetours: number;
}

/** A gap between nodes across a run's axis, from `low` to `high`. */
interface Street {
  low: number;
  high: number;
}

/**
 * Finds streets (gaps between nodes) that more parallel edges use than fit
 * into them. The runs that stay in such a street are the short, local ones;
 * for each of the others it picks a point in the nearest street that is free
 * of nodes over the run's whole length and clearly wider. Routing again with
 * these points as checkpoints moves the edges there. Does not change `geometry`.
 *
 * @returns edge id -> checkpoint
 */
export function findDetoursIn(geometry: RouteGeometry, options: DetourOptions): Map<string, Point> {
  return new DetourFinder(geometry, options).find();
}

/** findDetoursIn() for plain routes. @returns edge id -> checkpoint */
export function findDetours(
  routes: ReadonlyMap<string, readonly Point[]>,
  model: GraphModel,
  options: DetourOptions,
): Map<string, Point> {
  return findDetoursIn(new RouteGeometry(routes, model), options);
}

class DetourFinder {
  private readonly geometry: RouteGeometry;
  private readonly options: DetourOptions;
  /** How many detours each street got so far, to line them up. */
  private readonly sentToStreet = new Map<string, number>();

  constructor(geometry: RouteGeometry, options: DetourOptions) {
    this.geometry = geometry;
    this.options = options;
  }

  find(): Map<string, Point> {
    const detours = new Map<string, Point>();
    const evicted = this.evictedRuns().sort((a, b) => b.run.length - a.run.length);
    for (const { run, room } of evicted) {
      if (detours.size >= this.options.maxDetours) break;
      if (detours.has(run.edgeId)) continue;
      const street = this.nearestWideStreet(run, room);
      if (!street) continue;
      const position = this.positionInStreet(run, street);
      const [from, to] = run.extent;
      const middle = (from + to) / 2;
      detours.set(run.edgeId, run.axis === 'x' ? { x: position, y: middle } : { x: middle, y: position });
    }
    return detours;
  }

  /** Detours into the same street are lined up from its side facing the crowded one. */
  private positionInStreet(run: Run, street: Street): number {
    const key = `${run.axis}:${street.low}:${street.high}`;
    const count = (this.sentToStreet.get(key) ?? 0) + 1;
    this.sentToStreet.set(key, count);
    const step = run.width + this.options.spacing;
    const centre = (street.low + street.high) / 2;
    return street.low > run.position
      ? Math.min(centre, street.low + count * step)
      : Math.max(centre, street.high - count * step);
  }

  /** The runs that do not fit into their street, with the room it has. */
  private evictedRuns(): Array<{ run: Run; room: number }> {
    const evicted: Array<{ run: Run; room: number }> = [];
    for (const bundle of this.geometry.overlappingBundles()) {
      // end segments cannot leave their node, so only inner segments get detours
      const movable = bundle.filter((run) => run.movable && run.ends.length === 0);
      if (movable.length === 0) continue;
      const intervals = movable.map((run) => this.geometry.freeInterval(run));
      const room = Math.min(...intervals.map(([, high]) => high)) - Math.max(...intervals.map(([low]) => low));
      if (!Number.isFinite(room)) continue;
      let used = 0;
      for (const run of [...movable].sort((a, b) => a.length - b.length)) {
        const needed = run.width + this.options.spacing;
        if (used + needed <= room) used += needed;
        else evicted.push({ run, room });
      }
    }
    return evicted;
  }

  /**
   * The nearest street across the run's axis that is free over the run's whole
   * extent (keeping the clearance to the nodes) and clearly wider than the crowded
   * one. Outside the outermost nodes there is always room.
   */
  private nearestWideStreet(run: Run, crowdedRoom: number): Street | undefined {
    const { position } = run;
    const stroke = run.width + 1;
    const minWidth = Math.max(MIN_WIDENING * crowdedRoom, MIN_STREET_STROKES * stroke);
    const outerWidth = OUTER_STREET_STROKES * stroke; // a finite far side for the unbounded outer areas
    let best: Street | undefined;
    let bestDistance = Infinity;
    for (let street of this.streetsAcross(run)) {
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

  /** The gaps between the nodes beside the run, across its axis, from low to high. */
  private streetsAcross(run: Run): Street[] {
    const { clearance } = this.options;
    const blocked = this.geometry
      .obstaclesBeside(run, clearance)
      .map((node) => extentOf(node, run.axis, clearance))
      .sort((a, b) => a[0] - b[0]);
    const streets: Street[] = [];
    let low = -Infinity;
    for (const [start, end] of blocked) {
      if (start > low) streets.push({ low, high: start });
      low = Math.max(low, end);
    }
    streets.push({ low, high: Infinity });
    return streets;
  }
}
