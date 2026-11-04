/** A straight piece of an orthogonal route, the unit the post-processing moves. */

import { extentOf, halfSize, otherAxis } from '../shared/geometry';
import type { Axis, Point } from '../shared/geometry';
import { nodesById } from '../shared/graph';
import type { GraphModel, GraphNode } from '../shared/graph';

/** Distance kept between a moved stroke and a node border (px). */
export const NODE_MARGIN = 2;
/** How far a route end may lie off the node border and still count as on it (px). */
const BORDER_TOLERANCE = 0.5;
/** Overlaps shorter than this (px) do not count: they are just touching corners. */
export const MIN_SHARED_LENGTH = 1;

/** A route end: the node it is attached to and where the end point is in the route. */
export interface SegmentEnd
{
  /** The node the route starts or ends at. */
  node: GraphNode;
  /** Index of the end point in {@link Segment.route}: 0 or the last index. */
  pointIndex: number;
}

/** An orthogonal segment of a route, between `route[startIndex]` and `route[startIndex + 1]`. */
export class Segment
{
  /** Id of the edge whose route this segment is part of. */
  readonly edgeId: string;
  /** The whole route; moving the segment changes it in place. */
  readonly route: Point[];
  /** Where the segment starts in {@link Segment.route}. */
  readonly startIndex: number;
  /** The axis {@link Segment.position} is on, and the one the segment moves along: x for a vertical segment, y for a horizontal one. */
  readonly positionAxis: Axis;
  /** Stroke width of the edge (px). */
  readonly width: number;
  /** Set for the first and last segment: they may only slide along the side of these nodes. */
  readonly ends: SegmentEnd[] = [];
  /** False if an end of the segment cannot slide, e.g. its node is missing or the side is too short. */
  movable = true;

  /**
   * @param edgeId       id of the edge the route belongs to
   * @param route        the whole route, shared with the other segments of it
   * @param startIndex   index of the segment's first point in `route`
   * @param positionAxis x for a vertical segment, y for a horizontal one
   * @param width        stroke width of the edge (px)
   */
  constructor(edgeId: string, route: Point[], startIndex: number, positionAxis: Axis, width: number)
  {
    this.edgeId = edgeId;
    this.route = route;
    this.startIndex = startIndex;
    this.positionAxis = positionAxis;
    this.width = width;
  }

  /**
   * Splits all routes into their orthogonal segments; diagonal ones are skipped.
   * The routes are used as they are, not copied, so moving a segment changes them.
   *
   * @param routes edge id -> route points
   * @param model  the graph the routes belong to, for edge widths and end nodes
   * @returns the segments of all routes, in route order
   */
  static splitRoutes(routes: ReadonlyMap<string, Point[]>, model: GraphModel): Segment[]
  {
    const nodes = nodesById(model);
    const edges = new Map(model.edges.map((edge) => [edge.id, edge]));
    const segments: Segment[] = [];
    for (const [edgeId, route] of routes)
    {
      const edge = edges.get(edgeId);
      const last = route.length - 1;
      for (let index = 0; index < last; index++)
      {
        const a = route[index]!;
        const b = route[index + 1]!;
        const positionAxis = a.x === b.x ? 'x' : a.y === b.y ? 'y' : undefined;
        if (!positionAxis)
        {
          continue; // not orthogonal
        }
        const segment = new Segment(edgeId, route, index, positionAxis, edge?.width || 0);
        const ends = [
          { isEnd: index === 0, nodeId: edge?.source, pointIndex: 0 },
          { isEnd: index + 1 === last, nodeId: edge?.target, pointIndex: last },
        ];
        for (const { isEnd, nodeId, pointIndex } of ends)
        {
          if (!isEnd)
          {
            continue;
          }
          const node = nodeId === undefined ? undefined : nodes.get(nodeId);
          if (node)
          {
            segment.ends.push({ node, pointIndex });
          }
          else
          {
            segment.movable = false; // unknown edge or node: leave the segment where it is
          }
        }
        segment.movable &&= segment.ends.every((end) => segment.sideInterval(end) !== undefined);
        segments.push(segment);
      }
    }
    return segments;
  }

  /** Where the segment lies on {@link Segment.positionAxis}: the x of a vertical segment. */
  get position(): number
  {
    return this.route[this.startIndex]![this.positionAxis];
  }

  /** From where to where the segment reaches along its length, on the other axis: the y range of a vertical segment. */
  get span(): [number, number]
  {
    const along = otherAxis(this.positionAxis);
    const a = this.route[this.startIndex]![along];
    const b = this.route[this.startIndex + 1]![along];
    return a < b ? [a, b] : [b, a];
  }

  /** How long the segment is (px). */
  get length(): number
  {
    const [from, to] = this.span;
    return to - from;
  }

  /**
   * Length along which this segment and a parallel one of another edge lie so close
   * that their strokes touch. Overlaps up to {@link MIN_SHARED_LENGTH} do not count.
   *
   * @param other the segment to compare with
   * @returns the shared length (px); 0 for perpendicular segments and segments of the same edge
   */
  overlapLength(other: Segment): number
  {
    if (this.positionAxis !== other.positionAxis || this.edgeId === other.edgeId)
    {
      return 0;
    }
    if (Math.abs(this.position - other.position) >= (this.width + other.width) / 2)
    {
      return 0;
    }
    const [a1, a2] = this.span;
    const [b1, b2] = other.span;
    const shared = Math.min(a2, b2) - Math.max(a1, b1);
    return shared > MIN_SHARED_LENGTH ? shared : 0;
  }

  /**
   * Whether this segment and a perpendicular one of another edge cross in an X.
   *
   * @param other the segment to compare with
   * @returns true if they cross; false if they only touch at an end, are parallel or belong to the same edge
   */
  crosses(other: Segment): boolean
  {
    if (this.positionAxis === other.positionAxis || this.edgeId === other.edgeId)
    {
      return false;
    }
    const [aFrom, aTo] = this.span;
    const [bFrom, bTo] = other.span;
    return aFrom < other.position && other.position < aTo && bFrom < this.position && this.position < bTo;
  }

  /**
   * Where an end segment may lie along {@link Segment.positionAxis}: on the node
   * side its end point is on, with the whole stroke inside the side.
   *
   * @param end one of {@link Segment.ends}
   * @returns `[low, high]`, or undefined if the end point is not on a side across the
   *   segment or the side is too short for the stroke
   */
  sideInterval({ node, pointIndex }: SegmentEnd): [number, number] | undefined
  {
    const { positionAxis } = this;
    const along = otherAxis(positionAxis);
    const end = this.route[pointIndex]!;
    const onSideLine = Math.abs(Math.abs(end[along] - node[along]) - halfSize(node, along)) <= BORDER_TOLERANCE;
    const withinSide =
      Math.abs(end[positionAxis] - node[positionAxis]) <= halfSize(node, positionAxis) + BORDER_TOLERANCE;
    if (!onSideLine || !withinSide)
    {
      return undefined;
    }
    const [low, high] = extentOf(node, positionAxis, -(this.width / 2 + NODE_MARGIN));
    return low <= high ? [low, high] : undefined;
  }
}
