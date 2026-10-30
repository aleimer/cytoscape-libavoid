/**
 * Post-processing of the routes libavoid returns. libavoid keeps a clearance
 * (shapeBufferDistance) around nodes and does not nudge segments into it, so
 * where many edges share a narrow gap between nodes it stacks them on the same
 * line. These steps work on a RouteGeometry to deal with that:
 *
 * - findDetoursIn() (detour-finder.ts) finds gaps between nodes that more edges
 *   use than fit into them and picks checkpoints in wider gaps for the edges
 *   that only pass through; EdgeRouter routes again through them.
 * - separateOverlapsIn() (overlap-separator.ts) spreads the remaining
 *   overlapping segments apart by their widths, using part of the clearance if
 *   necessary, but never entering a node. The first and last segment of a route
 *   only slide along the node side they end at, so edges that share the pin in
 *   the middle of a side fan out along it. Moving a vertical segment sideways
 *   only stretches its horizontal neighbours (and vice versa), so routes stay
 *   orthogonal.
 * - centreThickestEdgesIn() (thickest-edge-centring.ts) moves the thickest edge on a node
 *   side with more than two edge ends to the centre of the side.
 * - measureQuality() (route-quality.ts) measures overlaps, crossings and
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
  readonly model: GraphModel;
  /** A copy of the routes; moving segments changes it, the input stays as it is. */
  readonly routes: Map<string, Point[]>;
  readonly segments: readonly Segment[];
  private readonly index: SegmentIndex;

  constructor(routes: ReadonlyMap<string, readonly Point[]>, model: GraphModel)
  {
    this.model = model;
    this.routes = new Map([...routes].map(([edgeId, points]) => [edgeId, points.map((point) => ({ ...point }))]));
    this.segments = Segment.allOf(this.routes, model);
    this.index = new SegmentIndex(this.segments);
  }

  /** Segments of other edges whose strokes overlap this one. */
  overlapping(segment: Segment): Segment[]
  {
    return this.index.overlapping(segment);
  }

  /** Segments on `axis` positioned between `low` and `high` (and a few just outside). */
  between(axis: Axis, low: number, high: number): Segment[]
  {
    return this.index.between(axis, low, high);
  }

  /** Moves a segment to a new position on its axis; its neighbouring segments stretch. */
  move(segment: Segment, position: number): void
  {
    this.index.move(segment, position);
  }

  /** Groups of segments that overlap each other, directly or through other segments of the group. */
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
        for (const near of this.index.overlapping(bundle[i]!))
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
   * The obstacles beside a segment: those that reach into its span, grown by
   * `clearance`. Moving the segment across its axis would hit them.
   */
  obstaclesBeside(segment: Segment, clearance: number): GraphNode[]
  {
    const along = otherAxis(segment.axis);
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
   * End segments also stay on the side of their node. Fixed segments stay where they are.
   */
  freeInterval(segment: Segment): [number, number]
  {
    const { axis, route, index, position } = segment;
    if (!segment.movable)
    {
      return [position, position];
    }
    let low = -Infinity;
    let high = Infinity;

    // the neighbours keep their direction: route[index - 1] and route[index + 2] stay on their side
    for (const neighbour of [route[index - 1], route[index + 2]])
    {
      if (!neighbour)
      {
        continue; // an end segment
      }
      const value = neighbour[axis];
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
      const [nodeLow, nodeHigh] = extentOf(node, axis, clearance);
      if (nodeHigh <= position)
      {
        low = Math.max(low, nodeHigh);
      }
      else if (nodeLow >= position)
      {
        high = Math.min(high, nodeLow);
      }
      else
      {
        return [position, position]; // already closer than the margin: leave it
      }
    }
    return [low, high];
  }
}
