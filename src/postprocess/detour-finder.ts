// Finds detours for edges that do not fit into a crowded gap, see route-geometry.ts.

import { extentOf } from '../shared/geometry';
import type { Point } from '../shared/geometry';
import type { GraphModel } from '../shared/graph';
import { RouteGeometry } from './route-geometry';
import type { Segment } from './segment';

/** The gap of a detour is at least this many times as wide as the crowded one... */
const MIN_WIDENING = 2;
/** ...and has room for at least this many strokes of the segment. */
const MIN_GAP_STROKES = 4;
/** The unbounded areas outside the outermost nodes count as this many strokes wide. */
const OUTER_GAP_STROKES = 10;

export interface DetourOptions {
  /** Space kept between neighbouring strokes (px). */
  spacing: number;
  /** libavoid's shapeBufferDistance; the detour gap keeps it to the nodes. */
  clearance: number;
  /**
   * At most this many detours, the segments passing through over the longest distance first:
   * every checkpoint makes the second libavoid run slower.
   */
  maxDetours: number;
}

/** A gap between nodes across a segment's axis, from `low` to `high`. */
interface Gap {
  low: number;
  high: number;
}

/**
 * Finds gaps between nodes that more parallel edges use than fit
 * into them. The segments that stay in such a gap are the short, local ones;
 * for each of the others it picks a point in the nearest gap that is free
 * of nodes over the segment's whole length and clearly wider. Routing again with
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

/** The search behind findDetoursIn(), with the bookkeeping of the gaps that already got detours. */
class DetourFinder {
  private readonly geometry: RouteGeometry;
  private readonly options: DetourOptions;
  /** How many detours each gap got so far, to line them up. */
  private readonly sentToGap = new Map<string, number>();

  constructor(geometry: RouteGeometry, options: DetourOptions) {
    this.geometry = geometry;
    this.options = options;
  }

  /**
   * Edge id -> checkpoint for the edges that do not fit into their gap: the
   * longest segments first, at most `maxDetours`, only where a clearly wider gap is near.
   */
  find(): Map<string, Point> {
    const detours = new Map<string, Point>();
    const evicted = this.evictedSegments().sort((a, b) => b.segment.length - a.segment.length);
    for (const { segment, room } of evicted) {
      if (detours.size >= this.options.maxDetours) break;
      if (detours.has(segment.edgeId)) continue;
      const gap = this.nearestWideGap(segment, room);
      if (!gap) continue;
      const position = this.positionInGap(segment, gap);
      const [from, to] = segment.span;
      const middle = (from + to) / 2;
      detours.set(segment.edgeId, segment.axis === 'x' ? { x: position, y: middle } : { x: middle, y: position });
    }
    return detours;
  }

  /** Detours into the same gap are lined up from its side facing the crowded one. */
  private positionInGap(segment: Segment, gap: Gap): number {
    const key = `${segment.axis}:${gap.low}:${gap.high}`;
    const count = (this.sentToGap.get(key) ?? 0) + 1;
    this.sentToGap.set(key, count);
    const step = segment.width + this.options.spacing;
    const centre = (gap.low + gap.high) / 2;
    return gap.low > segment.position
      ? Math.min(centre, gap.low + count * step)
      : Math.max(centre, gap.high - count * step);
  }

  /** The segments that do not fit into their gap, with the room it has. */
  private evictedSegments(): Array<{ segment: Segment; room: number }> {
    const evicted: Array<{ segment: Segment; room: number }> = [];
    for (const bundle of this.geometry.overlappingBundles()) {
      // end segments cannot leave their node, so only inner segments get detours
      const movable = bundle.filter((segment) => segment.movable && segment.ends.length === 0);
      if (movable.length === 0) continue;
      const intervals = movable.map((segment) => this.geometry.freeInterval(segment));
      const room = Math.min(...intervals.map(([, high]) => high)) - Math.max(...intervals.map(([low]) => low));
      if (!Number.isFinite(room)) continue;
      let used = 0;
      for (const segment of [...movable].sort((a, b) => a.length - b.length)) {
        const needed = segment.width + this.options.spacing;
        if (used + needed <= room) used += needed;
        else evicted.push({ segment, room });
      }
    }
    return evicted;
  }

  /**
   * The nearest gap across the segment's axis that is free over the segment's whole
   * length (keeping the clearance to the nodes) and clearly wider than the crowded
   * one. Outside the outermost nodes there is always room.
   */
  private nearestWideGap(segment: Segment, crowdedRoom: number): Gap | undefined {
    const { position } = segment;
    const stroke = segment.width + 1;
    const minWidth = Math.max(MIN_WIDENING * crowdedRoom, MIN_GAP_STROKES * stroke);
    const outerWidth = OUTER_GAP_STROKES * stroke; // a finite far side for the unbounded outer areas
    let best: Gap | undefined;
    let bestDistance = Infinity;
    for (let gap of this.gapsAcross(segment)) {
      if (gap.high - gap.low < minWidth) continue;
      if (gap.low <= position && position <= gap.high) continue; // the crowded gap itself
      if (!Number.isFinite(gap.low)) gap = { low: gap.high - outerWidth, high: gap.high };
      if (!Number.isFinite(gap.high)) gap = { low: gap.low, high: gap.low + outerWidth };
      const distance = position < gap.low ? gap.low - position : position - gap.high;
      if (distance < bestDistance) {
        best = gap;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** The gaps between the nodes beside the segment, across its axis, from low to high. */
  private gapsAcross(segment: Segment): Gap[] {
    const { clearance } = this.options;
    const blocked = this.geometry
      .obstaclesBeside(segment, clearance)
      .map((node) => extentOf(node, segment.axis, clearance))
      .sort((a, b) => a[0] - b[0]);
    const gaps: Gap[] = [];
    let low = -Infinity;
    for (const [start, end] of blocked) {
      if (start > low) gaps.push({ low, high: start });
      low = Math.max(low, end);
    }
    gaps.push({ low, high: Infinity });
    return gaps;
  }
}
