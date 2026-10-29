// Post-processing of the routes libavoid returns. libavoid keeps a clearance
// (shapeBufferDistance) around nodes and does not nudge segments into it, so
// where many edges share a narrow gap between nodes it stacks them on the same
// line. Three steps work on a RouteGeometry to deal with that:
//
// - findDetoursIn() (detour-finder.ts) finds gaps ("streets") that more edges
//   use than fit into them and picks checkpoints in wider streets for the edges
//   that only pass through; EdgeRouter routes again through them.
// - separateOverlapsIn() (overlap-separator.ts) spreads the remaining
//   overlapping segments apart by their widths, using part of the clearance if
//   necessary, but never entering a node. The first and last segment of a route
//   only slide along the node side they end at, so edges that share the pin in
//   the middle of a side fan out along it. Moving a vertical segment sideways
//   only stretches its horizontal neighbours (and vice versa), so routes stay
//   orthogonal.
// - measureQuality() (route-quality.ts) measures overlaps, crossings and
//   length, to compare routings.

import { extentOf, otherAxis } from '../shared/geometry';
import type { Axis, Point } from '../shared/geometry';
import { isObstacle } from '../shared/graph';
import type { GraphModel, GraphNode } from '../shared/graph';
import { NODE_MARGIN, Run } from './run';
import { RunIndex } from './run-index';

/** Routes split into runs, with a spatial index and the queries the post-processing steps share. */
export class RouteGeometry {
  readonly model: GraphModel;
  /** A copy of the routes; moving runs changes it, the input stays as it is. */
  readonly routes: Map<string, Point[]>;
  readonly runs: readonly Run[];
  private readonly index: RunIndex;

  constructor(routes: ReadonlyMap<string, readonly Point[]>, model: GraphModel) {
    this.model = model;
    this.routes = new Map([...routes].map(([edgeId, points]) => [edgeId, points.map((point) => ({ ...point }))]));
    this.runs = Run.allOf(this.routes, model);
    this.index = new RunIndex(this.runs);
  }

  /** Runs of other edges whose strokes overlap this one. */
  overlapping(run: Run): Run[] {
    return this.index.overlapping(run);
  }

  /** Runs on `axis` positioned between `low` and `high` (and a few just outside). */
  between(axis: Axis, low: number, high: number): Run[] {
    return this.index.between(axis, low, high);
  }

  /** Moves a run to a new position on its axis; its neighbouring segments stretch. */
  move(run: Run, position: number): void {
    this.index.move(run, position);
  }

  /** Groups of runs that overlap each other, directly or through other runs of the group. */
  overlappingBundles(): Run[][] {
    const bundleOf = new Map<Run, Run[]>();
    const bundles: Run[][] = [];
    for (const start of this.runs) {
      if (bundleOf.has(start)) continue;
      const bundle = [start];
      bundleOf.set(start, bundle);
      for (let i = 0; i < bundle.length; i++) {
        for (const near of this.index.overlapping(bundle[i]!)) {
          if (bundleOf.has(near)) continue;
          bundleOf.set(near, bundle);
          bundle.push(near);
        }
      }
      if (bundle.length > 1) bundles.push(bundle);
    }
    return bundles;
  }

  /**
   * The obstacles beside a run: those that reach into its extent, grown by
   * `clearance`. Moving the run across its axis would hit them.
   */
  obstaclesBeside(run: Run, clearance: number): GraphNode[] {
    const along = otherAxis(run.axis);
    const [from, to] = run.extent;
    return this.model.nodes.filter((node) => {
      if (!isObstacle(node)) return false;
      const [low, high] = extentOf(node, along, clearance);
      return high > from && low < to;
    });
  }

  /**
   * Where a run may be placed along its axis without entering a node, without
   * reversing its neighbouring segments and without passing the ones beyond them.
   * End segments also stay on the side of their node. Fixed runs stay where they are.
   */
  freeInterval(run: Run): [number, number] {
    const { axis, route, index, position } = run;
    if (!run.movable) return [position, position];
    let low = -Infinity;
    let high = Infinity;

    // the neighbours keep their direction: route[index - 1] and route[index + 2] stay on their side
    for (const neighbour of [route[index - 1], route[index + 2]]) {
      if (!neighbour) continue; // an end segment
      const value = neighbour[axis];
      if (value < position) low = Math.max(low, value + 1);
      else if (value > position) high = Math.min(high, value - 1);
      else return [position, position];
    }

    for (const end of run.ends) {
      const [sideLow, sideHigh] = run.sideInterval(end)!;
      low = Math.max(low, sideLow);
      high = Math.min(high, sideHigh);
    }

    const attached = new Set(run.ends.map((end) => end.node));
    const clearance = run.width / 2 + NODE_MARGIN;
    // incl. the nodes at its end points where the neighbours run along them
    for (const node of this.obstaclesBeside(run, clearance)) {
      if (attached.has(node)) continue;
      const [nodeLow, nodeHigh] = extentOf(node, axis, clearance);
      if (nodeHigh <= position) low = Math.max(low, nodeHigh);
      else if (nodeLow >= position) high = Math.min(high, nodeLow);
      else return [position, position]; // already closer than the margin: leave it
    }
    return [low, high];
  }
}
