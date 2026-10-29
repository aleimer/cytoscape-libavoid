// A straight piece of an orthogonal route, the unit the post-processing moves.

import { extentOf, halfSize, otherAxis } from '../shared/geometry';
import type { Axis, Point } from '../shared/geometry';
import { nodesById } from '../shared/graph';
import type { GraphModel, GraphNode } from '../shared/graph';

/** Distance kept between a moved stroke and a node border (px). */
export const NODE_MARGIN = 2;
/** How far a route end may lie off the node border and still count as on it (px). */
const BORDER_TOLERANCE = 0.5;
/** Shorter shared runs do not count as overlaps; they are just touching corners. */
export const MIN_SHARED_RUN = 1;

/** A route end: the node it is attached to and the index of the end point in the route. */
export interface RunEnd {
  node: GraphNode;
  point: number;
}

/** An orthogonal segment of a route, between route[index] and route[index + 1]. */
export class Run {
  readonly edgeId: string;
  /** The whole route; moving the run changes it in place. */
  readonly route: Point[];
  readonly index: number;
  /** The coordinate the segment can be moved along: x for a vertical segment, y for a horizontal one. */
  readonly axis: Axis;
  readonly width: number;
  /** Set for the first and last segment: they may only slide along the side of these nodes. */
  readonly ends: RunEnd[] = [];
  /** False if an end of the segment cannot slide, e.g. its node is missing or the side is too short. */
  movable = true;

  constructor(edgeId: string, route: Point[], index: number, axis: Axis, width: number) {
    this.edgeId = edgeId;
    this.route = route;
    this.index = index;
    this.axis = axis;
    this.width = width;
  }

  /** The orthogonal segments of all routes as runs; the routes are used as they are, not copied. */
  static allOf(routes: ReadonlyMap<string, Point[]>, model: GraphModel): Run[] {
    const nodes = nodesById(model);
    const edges = new Map(model.edges.map((edge) => [edge.id, edge]));
    const runs: Run[] = [];
    for (const [edgeId, route] of routes) {
      const edge = edges.get(edgeId);
      const last = route.length - 1;
      for (let index = 0; index < last; index++) {
        const a = route[index]!;
        const b = route[index + 1]!;
        const axis = a.x === b.x ? 'x' : a.y === b.y ? 'y' : undefined;
        if (!axis) continue; // not orthogonal
        const run = new Run(edgeId, route, index, axis, edge?.width || 0);
        const endNodes = [index === 0 && edge?.source, index + 1 === last && edge?.target];
        endNodes.forEach((nodeId, i) => {
          if (nodeId === false) return; // not an end segment on this side
          const node = nodeId === undefined ? undefined : nodes.get(nodeId);
          if (node) run.ends.push({ node, point: i === 0 ? 0 : last });
          else run.movable = false; // unknown node: leave the segment where it is
        });
        run.movable &&= run.ends.every((end) => run.sideInterval(end) !== undefined);
        runs.push(run);
      }
    }
    return runs;
  }

  /** Where the run lies on its axis. */
  get position(): number {
    return this.route[this.index]![this.axis];
  }

  /** From where to where the run reaches across its axis. */
  get extent(): [number, number] {
    const along = otherAxis(this.axis);
    const a = this.route[this.index]![along];
    const b = this.route[this.index + 1]![along];
    return a < b ? [a, b] : [b, a];
  }

  get length(): number {
    const [from, to] = this.extent;
    return to - from;
  }

  /** Length along which this run and a parallel one of another edge lie so close that their strokes touch. */
  overlapLength(other: Run): number {
    if (this.axis !== other.axis || this.edgeId === other.edgeId) return 0;
    if (Math.abs(this.position - other.position) >= (this.width + other.width) / 2) return 0;
    const [a1, a2] = this.extent;
    const [b1, b2] = other.extent;
    const shared = Math.min(a2, b2) - Math.max(a1, b1);
    return shared > MIN_SHARED_RUN ? shared : 0;
  }

  /** True if this run and a perpendicular one of another edge cross in an X (not touching at an end). */
  crosses(other: Run): boolean {
    if (this.axis === other.axis || this.edgeId === other.edgeId) return false;
    const [aFrom, aTo] = this.extent;
    const [bFrom, bTo] = other.extent;
    return aFrom < other.position && other.position < aTo && bFrom < this.position && this.position < bTo;
  }

  /**
   * Where an end segment may lie along its axis: on the node side its end point
   * is on, with the whole stroke inside the side. Undefined if the end point is
   * not on a side across the segment or the side is too short for the stroke.
   */
  sideInterval({ node, point }: RunEnd): [number, number] | undefined {
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
