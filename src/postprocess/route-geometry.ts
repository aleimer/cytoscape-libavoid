/**
 * Post-processing of the routes libavoid returns. libavoid keeps a clearance
 * (shapeBufferDistance) around nodes and does not nudge segments into it, so
 * where many edges share a narrow gap between nodes it stacks them on the same
 * line. These steps work on a RouteGeometry to deal with that:
 *
 * - findDetours() (detour-finder.ts) finds gaps between nodes that more edges
 *   use than fit into them and picks checkpoints in wider gaps for the edges
 *   that only pass through; routing again through them moves the edges there.
 * - separateOverlaps() (overlap-separator.ts) spreads the remaining
 *   overlapping segments apart by their widths, using part of the clearance if
 *   necessary, but never entering a node. The first and last segment of a route
 *   only slide along the node side they end at, so edges that share the pin in
 *   the centre of a side fan out along it. Moving a vertical segment sideways
 *   only stretches its horizontal neighbours (and vice versa), so routes stay
 *   orthogonal.
 * - centreWidestEdges() (widest-edge-centring.ts) moves the widest edge on a node
 *   side with more than two edge ends to the centre of the side.
 * - measureGeometry() (route-quality.ts) measures overlaps, crossings and
 *   length, to compare routings.
 */

import { extentOf, otherAxis } from '../shared/geometry';
import type { Axis, Point } from '../shared/geometry';
import { isObstacle } from '../shared/graph';
import type { GraphModel, GraphNode } from '../shared/graph';
import { NODE_MARGIN, Segment } from './segment';
import { SegmentIndex } from './segment-index';

/** Routes split into segments, with a spatial index and the queries the post-processing steps share. */
export class RouteGeometry
{
  /** The graph the routes belong to. */
  readonly model: GraphModel;
  /** A copy of the routes; moving segments changes it, the input stays as it is. */
  readonly routes: Map<string, Point[]>;
  /** All orthogonal segments of {@link RouteGeometry.routes}, see {@link Segment.splitRoutes}. */
  readonly segments: readonly Segment[];
  /** Finds segments by position; every move goes through it. */
  private readonly spatialIndex: SegmentIndex;
  /** The segments of each route, to find the ones next to a segment in its route. */
  private readonly segmentsByRoute = new Map<Point[], Segment[]>();

  /**
   * @param routes edge id -> route points; copied, not changed
   * @param model  the graph the routes belong to, for edge widths and nodes
   */
  constructor(routes: ReadonlyMap<string, readonly Point[]>, model: GraphModel)
  {
    this.model = model;
    this.routes = new Map([...routes].map(([edgeId, points]) => [edgeId, points.map((point) => ({ ...point }))]));
    this.segments = Segment.splitRoutes(this.routes, model);
    this.spatialIndex = new SegmentIndex(this.segments);
    for (const segment of this.segments)
    {
      this.segmentsByRoute.set(segment.route, [...(this.segmentsByRoute.get(segment.route) ?? []), segment]);
    }
  }

  /**
   * Segments of other edges whose strokes overlap a segment, see {@link SegmentIndex.overlapping}.
   *
   * @param segment one of {@link RouteGeometry.segments}
   * @returns the overlapping segments
   */
  overlapping(segment: Segment): Segment[]
  {
    return this.spatialIndex.overlapping(segment);
  }

  /**
   * Total length along which some segments overlap segments of other edges. A pair
   * of two given segments counts twice.
   *
   * @param segments segments of this geometry
   * @returns the summed {@link Segment.overlapLength} (px)
   */
  overlapLengthOf(segments: Iterable<Segment>): number
  {
    let total = 0;
    for (const segment of segments)
    {
      for (const near of this.spatialIndex.overlapping(segment))
      {
        total += segment.overlapLength(near);
      }
    }
    return total;
  }

  /**
   * Some segments and the ones next to them in their routes: moving a segment
   * across its axis stretches its neighbours, so they are affected too.
   *
   * @param segments segments of this geometry
   * @returns a new set with `segments` and their neighbours
   */
  withRouteNeighbours(segments: Iterable<Segment>): Set<Segment>
  {
    const affected = new Set<Segment>(segments);
    for (const segment of [...affected])
    {
      for (const neighbour of this.segmentsByRoute.get(segment.route) ?? [])
      {
        if (Math.abs(neighbour.startIndex - segment.startIndex) === 1)
        {
          affected.add(neighbour);
        }
      }
    }
    return affected;
  }

  /**
   * Segments on an axis positioned between two coordinates, and a few just outside:
   * callers check exactly. See {@link SegmentIndex.segmentsBetween}.
   *
   * @param axis the {@link Segment.positionAxis} of the segments to find
   * @param low  the lowest position
   * @param high the highest position
   * @returns the segments, in no particular order
   */
  segmentsBetween(axis: Axis, low: number, high: number): Segment[]
  {
    return this.spatialIndex.segmentsBetween(axis, low, high);
  }

  /**
   * Moves a segment to a new position on its axis; its neighbouring segments stretch.
   *
   * @param segment  one of {@link RouteGeometry.segments}
   * @param position the new position, e.g. within {@link RouteGeometry.freeInterval}
   */
  move(segment: Segment, position: number): void
  {
    this.spatialIndex.move(segment, position);
  }

  /**
   * Groups of segments that overlap each other, directly or through other segments of the group.
   *
   * @returns the groups with at least two segments; every segment is in one group at most
   */
  overlappingBundles(): Segment[][]
  {
    const bundleOf = new Map<Segment, Segment[]>();
    const bundles: Segment[][] = [];
    for (const start of this.segments)
    {
      if (bundleOf.has(start))
      {
        continue;
      }
      const bundle = [start];
      bundleOf.set(start, bundle);
      for (let i = 0; i < bundle.length; i++)
      {
        for (const near of this.spatialIndex.overlapping(bundle[i]!))
        {
          if (bundleOf.has(near))
          {
            continue;
          }
          bundleOf.set(near, bundle);
          bundle.push(near);
        }
      }
      if (bundle.length > 1)
      {
        bundles.push(bundle);
      }
    }
    return bundles;
  }

  /**
   * The obstacles beside a segment: moving it across its axis would hit them.
   *
   * @param segment   the segment
   * @param clearance added around every node before checking
   * @returns the obstacles that reach into the segment's {@link Segment.span}, grown by `clearance`
   */
  obstaclesBeside(segment: Segment, clearance: number): GraphNode[]
  {
    const along = otherAxis(segment.positionAxis);
    const [from, to] = segment.span;
    return this.model.nodes.filter((node) =>
    {
      if (!isObstacle(node))
      {
        return false;
      }
      const [low, high] = extentOf(node, along, clearance);
      return high > from && low < to;
    });
  }

  /**
   * Where a segment may be placed along its axis without entering a node, without
   * reversing its neighbouring segments and without passing the ones beyond them.
   * End segments also stay on the side of their node. Fixed segments stay where they are;
   * one already closer to a node than {@link NODE_MARGIN} may only move away from it.
   *
   * @param segment one of {@link RouteGeometry.segments}
   * @returns `[low, high]` on {@link Segment.positionAxis}; may be unbounded (±Infinity)
   */
  freeInterval(segment: Segment): [number, number]
  {
    const { positionAxis, route, startIndex, position } = segment;
    if (!segment.movable)
    {
      return [position, position];
    }
    let low = -Infinity;
    let high = Infinity;

    // the neighbours keep their direction: route[startIndex - 1] and route[startIndex + 2] stay on their side
    for (const neighbour of [route[startIndex - 1], route[startIndex + 2]])
    {
      if (!neighbour)
      {
        continue; // an end segment
      }
      const value = neighbour[positionAxis];
      if (value < position)
      {
        low = Math.max(low, value + 1);
      }
      else if (value > position)
      {
        high = Math.min(high, value - 1);
      }
      else
      {
        return [position, position];
      }
    }

    for (const end of segment.ends)
    {
      const [sideLow, sideHigh] = segment.sideInterval(end)!;
      low = Math.max(low, sideLow);
      high = Math.min(high, sideHigh);
    }

    const attached = new Set(segment.ends.map((end) => end.node));
    const clearance = segment.width / 2 + NODE_MARGIN;
    // incl. the nodes at its end points where the neighbouring segments lie along them
    for (const node of this.obstaclesBeside(segment, clearance))
    {
      if (attached.has(node))
      {
        continue;
      }
      const [nodeLow, nodeHigh] = extentOf(node, positionAxis, clearance);
      if (nodeHigh <= position)
      {
        low = Math.max(low, nodeHigh);
      }
      else if (nodeLow >= position)
      {
        high = Math.min(high, nodeLow);
      }
      // already closer than the margin: it may only move away from the node
      else if (node[positionAxis] > position)
      {
        high = Math.min(high, position);
      }
      else
      {
        low = Math.max(low, position);
      }
    }
    return [low, high];
  }
}
