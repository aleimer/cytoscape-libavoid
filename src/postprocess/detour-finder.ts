/** Finds detours for edges that do not fit into a crowded gap, see route-geometry.ts. */

import { extentOf } from '../shared/geometry';
import type { Point } from '../shared/geometry';
import type { RouteGeometry } from './route-geometry';
import type { Segment } from './segment';

/** The gap of a detour is at least this many times as wide as the crowded one... */
const MIN_WIDENING = 2;
/** ...and has room for at least this many strokes of the segment. */
const MIN_GAP_STROKES = 4;
/** The unbounded areas outside the outermost nodes count as this many strokes wide. */
const OUTER_GAP_STROKES = 10;

/** What {@link findDetours} needs to know beyond the routes. */
export interface DetourOptions
{
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

/** A gap between nodes across a segment's axis. */
interface Gap
{
  /** Where the gap starts on the segment's {@link Segment.positionAxis}; may be -Infinity. */
  low: number;
  /** Where it ends; may be Infinity. */
  high: number;
}

/** A segment that does not fit into its crowded gap. */
interface Evicted
{
  /** The segment to detour. */
  segment: Segment;
  /** How wide the crowded gap is (px). */
  room: number;
}

/**
 * Finds gaps between nodes that more parallel edges use than fit
 * into them. The segments that stay in such a gap are the short, local ones;
 * for each of the others it picks a point in the nearest gap that is free
 * of nodes over the segment's whole length and clearly wider. Routing again with
 * these points as checkpoints moves the edges there.
 *
 * @param geometry the routes of a libavoid run, before they are separated; not changed
 * @param options  spacing, clearance and the maximum number of detours
 * @returns edge id -> checkpoint
 */
export function findDetours(geometry: RouteGeometry, options: DetourOptions): Map<string, Point>
{
  return new DetourFinder(geometry, options).find();
}

/** The search behind {@link findDetours}, with the bookkeeping of the gaps that already got detours. */
class DetourFinder
{
  /** The routes to search; never changed. */
  private readonly geometry: RouteGeometry;
  /** See {@link findDetours}. */
  private readonly options: DetourOptions;
  /** How many detours each gap got so far, to line them up; keyed by axis and gap bounds. */
  private readonly sentToGap = new Map<string, number>();

  /**
   * @param geometry the routes to search
   * @param options  spacing, clearance and the maximum number of detours
   */
  constructor(geometry: RouteGeometry, options: DetourOptions)
  {
    this.geometry = geometry;
    this.options = options;
  }

  /**
   * Picks a checkpoint for each edge that does not fit into its gap: the longest
   * segments first, at most `maxDetours`, only where a clearly wider gap is near.
   *
   * @returns edge id -> checkpoint
   */
  find(): Map<string, Point>
  {
    const detours = new Map<string, Point>();
    const evicted = this.evictedSegments().sort((a, b) => b.segment.length - a.segment.length);
    for (const { segment, room } of evicted)
    {
      if (detours.size >= this.options.maxDetours)
      {
        break;
      }
      if (detours.has(segment.edgeId))
      {
        continue;
      }
      const gap = this.nearestWideGap(segment, room);
      if (!gap)
      {
        continue;
      }
      const position = this.takePosition(segment, gap);
      const [from, to] = segment.span;
      const spanCentre = (from + to) / 2;
      detours.set(
        segment.edgeId,
        segment.positionAxis === 'x' ? { x: position, y: spanCentre } : { x: spanCentre, y: position },
      );
    }
    return detours;
  }

  /**
   * The next free position in a gap for a detour, and counts it as taken: detours
   * into the same gap line up from its side facing the crowded one, but not beyond its centre.
   *
   * @param segment the segment to detour; its width sets the step
   * @param gap     the gap it goes to, see {@link DetourFinder.nearestWideGap}
   * @returns the position on the segment's {@link Segment.positionAxis}
   */
  private takePosition(segment: Segment, gap: Gap): number
  {
    const key = `${segment.positionAxis}:${gap.low}:${gap.high}`;
    const count = (this.sentToGap.get(key) ?? 0) + 1;
    this.sentToGap.set(key, count);
    const step = segment.width + this.options.spacing;
    const centre = (gap.low + gap.high) / 2;
    return gap.low > segment.position ?
      Math.min(centre, gap.low + count * step) :
      Math.max(centre, gap.high - count * step);
  }

  /**
   * The segments that do not fit into their gap. Per bundle of overlapping inner
   * segments, the shortest ones stay as long as there is room; the rest are evicted.
   *
   * @returns the evicted segments with the room of their gap, unsorted
   */
  private evictedSegments(): Evicted[]
  {
    const evicted: Evicted[] = [];
    for (const bundle of this.geometry.overlappingBundles())
    {
      // end segments cannot leave their node, so only inner segments get detours
      const movable = bundle.filter((segment) => segment.movable && segment.ends.length === 0);
      if (movable.length === 0)
      {
        continue;
      }
      const intervals = movable.map((segment) => this.geometry.freeInterval(segment));
      const room = Math.min(...intervals.map(([, high]) => high)) - Math.max(...intervals.map(([low]) => low));
      if (!Number.isFinite(room))
      {
        continue;
      }
      let used = 0;
      for (const segment of [...movable].sort((a, b) => a.length - b.length))
      {
        const needed = segment.width + this.options.spacing;
        if (used + needed <= room)
        {
          used += needed;
        }
        else
        {
          evicted.push({ segment, room });
        }
      }
    }
    return evicted;
  }

  /**
   * The nearest gap across the segment's axis that is free over the segment's whole
   * length (keeping the clearance to the nodes) and clearly wider than the crowded
   * one. Outside the outermost nodes there is always room.
   *
   * @param segment     the segment to detour
   * @param crowdedRoom the width of its crowded gap (px)
   * @returns the gap, with an unbounded side made finite, or undefined if none is wide enough
   */
  private nearestWideGap(segment: Segment, crowdedRoom: number): Gap | undefined
  {
    const { position } = segment;
    const stroke = segment.width + 1;
    const minWidth = Math.max(MIN_WIDENING * crowdedRoom, MIN_GAP_STROKES * stroke);
    const outerWidth = OUTER_GAP_STROKES * stroke; // a finite far side for the unbounded outer areas
    let best: Gap | undefined;
    let bestDistance = Infinity;
    for (let gap of this.gapsAcross(segment))
    {
      if (gap.high - gap.low < minWidth)
      {
        continue;
      }
      if (gap.low <= position && position <= gap.high)
      {
        continue; // the crowded gap itself
      }
      if (!Number.isFinite(gap.low))
      {
        gap = { low: gap.high - outerWidth, high: gap.high };
      }
      if (!Number.isFinite(gap.high))
      {
        gap = { low: gap.low, high: gap.low + outerWidth };
      }
      const distance = position < gap.low ? gap.low - position : position - gap.high;
      if (distance < bestDistance)
      {
        best = gap;
        bestDistance = distance;
      }
    }
    return best;
  }

  /**
   * The gaps between the nodes beside a segment, across its axis.
   *
   * @param segment the segment whose span the nodes must reach into
   * @returns the gaps from low to high; the first and last are unbounded
   */
  private gapsAcross(segment: Segment): Gap[]
  {
    const { clearance } = this.options;
    const blocked = this.geometry
      .obstaclesBeside(segment, clearance)
      .map((node) => extentOf(node, segment.positionAxis, clearance))
      .sort((a, b) => a[0] - b[0]);
    const gaps: Gap[] = [];
    let low = -Infinity;
    for (const [start, end] of blocked)
    {
      if (start > low)
      {
        gaps.push({ low, high: start });
      }
      low = Math.max(low, end);
    }
    gaps.push({ low, high: Infinity });
    return gaps;
  }
}
