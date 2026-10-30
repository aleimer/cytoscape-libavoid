// A straight piece of an orthogonal route, the unit the post-processing moves.

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

/** A route end: the node it is attached to and the index of the end point in the route. */
export interface SegmentEnd {
  node: GraphNode;
  point: number;
}

/** An orthogonal segment of a route, between route[index] and route[index + 1]. */
export class Segment {
  readonly edgeId: string;
  /** The whole route; moving the segment changes it in place. */
  readonly route: Point[];
  /** Where the segment starts in `route`. */
  readonly index: number;
  /** The coordinate the segment can be moved along: x for a vertical segment, y for a horizontal one. */
  readonly axis: Axis;
  /** Stroke width of the edge (px). */
  readonly width: number;
  /** Set for the first and last segment: they may only slide along the side of these nodes. */
  readonly ends: SegmentEnd[] = [];
  /** False if an end of the segment cannot slide, e.g. its node is missing or the side is too short. */
  movable = true;

  constructor(edgeId: string, route: Point[], index: number, axis: Axis, width: number) {
    this.edgeId = edgeId;
    this.route = route;
    this.index = index;
    this.axis = axis;
    this.width = width;
  }

  /** All routes split into their orthogonal segments (others are skipped); the routes are used as they are, not copied. */
  static allOf(routes: ReadonlyMap<string, Point[]>, model: GraphModel): Segment[] {
    const nodes = nodesById(model);
    const edges = new Map(model.edges.map((edge) => [edge.id, edge]));
    const segments: Segment[] = [];
    for (const [edgeId, route] of routes) {
      const edge = edges.get(edgeId);
      const last = route.length - 1;
      for (let index = 0; index < last; index++) {
        const a = route[index]!;
        const b = route[index + 1]!;
        const axis = a.x === b.x ? 'x' : a.y === b.y ? 'y' : undefined;
        if (!axis) continue; // not orthogonal
        const segment = new Segment(edgeId, route, index, axis, edge?.width || 0);
        const endNodes = [index === 0 && edge?.source, index + 1 === last && edge?.target];
        endNodes.forEach((nodeId, i) => {
          if (nodeId === false) return; // not an end segment on this side
          const node = nodeId === undefined ? undefined : nodes.get(nodeId);
          if (node) segment.ends.push({ node, point: i === 0 ? 0 : last });
          else segment.movable = false; // unknown node: leave the segment where it is
        });
        segment.movable &&= segment.ends.every((end) => segment.sideInterval(end) !== undefined);
        segments.push(segment);
      }
    }
    return segments;
  }

  /** Where the segment lies on its axis: the x of a vertical segment. */
  get position(): number {
    return this.route[this.index]![this.axis];
  }

  /** From where to where the segment reaches along its length, on the other axis: the y range of a vertical segment. */
  get span(): [number, number] {
    const along = otherAxis(this.axis);
    const a = this.route[this.index]![along];
    const b = this.route[this.index + 1]![along];
    return a < b ? [a, b] : [b, a];
  }

  /** How long the segment is (px). */
  get length(): number {
    const [from, to] = this.span;
    return to - from;
  }

  /** Length along which this segment and a parallel one of another edge lie so close that their strokes touch. */
  overlapLength(other: Segment): number {
    if (this.axis !== other.axis || this.edgeId === other.edgeId) return 0;
    if (Math.abs(this.position - other.position) >= (this.width + other.width) / 2) return 0;
    const [a1, a2] = this.span;
    const [b1, b2] = other.span;
    const shared = Math.min(a2, b2) - Math.max(a1, b1);
    return shared > MIN_SHARED_LENGTH ? shared : 0;
  }

  /** True if this segment and a perpendicular one of another edge cross in an X (not touching at an end). */
  crosses(other: Segment): boolean {
    if (this.axis === other.axis || this.edgeId === other.edgeId) return false;
    const [aFrom, aTo] = this.span;
    const [bFrom, bTo] = other.span;
    return aFrom < other.position && other.position < aTo && bFrom < this.position && this.position < bTo;
  }

  /**
   * Where an end segment may lie along its axis: on the node side its end point
   * is on, with the whole stroke inside the side. Undefined if the end point is
   * not on a side across the segment or the side is too short for the stroke.
   */
  sideInterval({ node, point }: SegmentEnd): [number, number] | undefined {
    const { axis } = this;
    const along = otherAxis(axis);
    const end = this.route[point]!;
    const onSideLine = Math.abs(Math.abs(end[along] - node[along]) - halfSize(node, along)) <= BORDER_TOLERANCE;
    const withinSide = Math.abs(end[axis] - node[axis]) <= halfSize(node, axis) + BORDER_TOLERANCE;
    if (!onSideLine || !withinSide) return undefined;
    const [low, high] = extentOf(node, axis, -(this.width / 2 + NODE_MARGIN));
    return low <= high ? [low, high] : undefined;
  }
}
