// Routing logic: turns a plain graph model into orthogonal routes. Knows
// nothing about Cytoscape, so it can be tested in Node and reused with other
// renderers.

import type { Avoid, ConnEnd, ConnRef, ShapeRef } from '../libavoid/api';
import { LibavoidSession } from '../libavoid/libavoid-session';
import { sideFacing, sideMiddle, SIDES } from '../shared/geometry';
import { isObstacle, nodesById, routableEdges } from '../shared/graph';
import type { Point, Side } from '../shared/geometry';
import type { GraphEdge, GraphModel, GraphNode } from '../shared/graph';
import { findDetoursIn } from '../postprocess/detour-finder';
import { centreThickestEdgesIn } from '../postprocess/thickest-edge-centring';
import { separateOverlapsIn } from '../postprocess/overlap-separator';
import { measureQuality } from '../postprocess/route-quality';
import type { RouteQuality } from '../postprocess/route-quality';
import { RouteGeometry } from '../postprocess/route-geometry';
import { defaultRoutingOptions, resolveRoutingOptions } from './options';
import type { RoutingOptions } from './options';
import { simplify } from '../postprocess/simplify';

/**
 * Pins sit in the middle of a node's sides. An edge end's pin class is the sum of
 * the bits of the sides it may use (15 = all four); every obstacle gets the pins
 * of each class its edges use, and libavoid picks one of the class's pins.
 */
const SIDE_BIT: Record<Side, number> = { top: 1, right: 2, bottom: 4, left: 8 };
/** With `idealNudgingDistance: 'auto'`: the smallest gap between parallel segments (px), also for thin edges. */
const MIN_NUDGING_DISTANCE = 4;
/**
 * Share of the edges that may get a detour, those passing through over the longest
 * distance first. 30 % worked best on the bench graphs; more checkpoints make the
 * second libavoid run slower without reducing the overlaps much further.
 */
const MAX_DETOUR_SHARE = 0.3;
/** libavoid needs a non-empty rectangle. */
const MIN_SHAPE_SIZE = 1;
/** Detoured routes are kept if they overlap at least 20 % less... */
const MIN_OVERLAP_GAIN = 0.2;
/** ...are at most 10 % longer... */
const MAX_EXTRA_LENGTH = 0.1;
/** ...and cross at most 50 % more often, plus 5 crossings (for graphs with few). */
const MAX_EXTRA_CROSSINGS = 0.5;
const EXTRA_CROSSINGS_ALLOWED = 5;

/** Routes the edges of a graph model around its nodes with libavoid. */
export class EdgeRouter {
  readonly options: RoutingOptions;
  private readonly avoid: Avoid;

  /** @param avoid initialised libavoid instance, see loadLibavoid() */
  constructor(avoid: Avoid, options: Partial<RoutingOptions> = {}) {
    this.avoid = avoid;
    this.options = resolveRoutingOptions(defaultRoutingOptions, options);
  }

  /**
   * Routes once with libavoid, looks for edges that do not fit into crowded gaps
   * and spreads apart overlapping segments. If some edges need a detour, routes a
   * second time through checkpoints in wider gaps and keeps whichever result is
   * better (see isBetter()). Finally the thickest edge on a node side with more
   * than two edges moves to its centre, and the overlaps that causes are spread
   * apart again. Loops and edges with a missing end are skipped.
   *
   * @returns edge id -> route points, from the source end to the target end
   */
  route(model: GraphModel): Map<string, Point[]> {
    const routable: GraphModel = { nodes: model.nodes, edges: routableEdges(model) };
    const first = new RouteGeometry(this.routeOnce(routable), routable);
    const detours = this.options.detourCrowded ? this.findDetours(first) : new Map<string, Point>();
    this.separate(first);
    let result = first;
    if (detours.size > 0) {
      const second = new RouteGeometry(this.routeOnce(routable, detours), routable);
      this.separate(second);
      if (isBetter(measureQuality(second), measureQuality(first))) result = second;
    }
    centreThickestEdgesIn(result, this.options.edgeSpacing);
    this.separate(result); // the reordered fans can put bends next to the node on top of each other
    return result.routes;
  }

  /** Checkpoints for the edges that do not fit into crowded gaps; reads the geometry before it is separated. */
  private findDetours(geometry: RouteGeometry): Map<string, Point> {
    const { edgeSpacing, shapeBufferDistance } = this.options;
    const maxDetours = Math.ceil(MAX_DETOUR_SHARE * geometry.model.edges.length);
    return findDetoursIn(geometry, { spacing: edgeSpacing, clearance: shapeBufferDistance, maxDetours });
  }

  /** With `separateOverlaps`: spreads apart overlapping segments, in place. */
  private separate(geometry: RouteGeometry): void {
    if (this.options.separateOverlaps) separateOverlapsIn(geometry, this.options.edgeSpacing);
  }

  /** One libavoid run; `model.edges` must be routable, see routableEdges(). */
  private routeOnce(model: GraphModel, checkpoints: ReadonlyMap<string, Point> = new Map()): Map<string, Point[]> {
    const session = new LibavoidSession(this.avoid);
    try {
      this.configure(session, model.edges);
      const shapes = this.addShapes(session, model);
      const connectors = this.addConnectors(session, shapes, model);
      for (const [edgeId, point] of checkpoints) {
        const connector = connectors.get(edgeId);
        if (connector) session.setCheckpoints(connector, [point]);
      }
      session.route();
      const routes = new Map<string, Point[]>();
      for (const [edgeId, connector] of connectors) routes.set(edgeId, simplify(session.pointsOf(connector)));
      return routes;
    } finally {
      session.dispose();
    }
  }

  /** libavoid's parameters from the options; the raw `routingParameters` / `routingOptions` win. */
  private configure(session: LibavoidSession, edges: GraphEdge[]): void {
    const { options } = this;
    const widest = edges.reduce((max, edge) => Math.max(max, edge.width || 0), 0);
    const nudgingDistance =
      options.idealNudgingDistance === 'auto'
        ? Math.max(MIN_NUDGING_DISTANCE, widest + options.edgeSpacing)
        : options.idealNudgingDistance;

    session.setParameter('shapeBufferDistance', options.shapeBufferDistance);
    session.setParameter('idealNudgingDistance', nudgingDistance);
    session.setOption('nudgeOrthogonalSegmentsConnectedToShapes', options.nudgeConnectedSegments);
    // on in libavoid by default; it takes ~98 % of the routing time (64 nodes /
    // 112 edges: 3.4 s instead of 50 ms) for slightly fewer bends
    session.setOption('performUnifyingNudgingPreprocessingStep', false);

    // raw values last, so they override everything above
    for (const [name, value] of Object.entries(options.routingParameters)) {
      if (value !== undefined) session.setParameter(name, value);
    }
    for (const [name, value] of Object.entries(options.routingOptions)) {
      if (value !== undefined) session.setOption(name, value);
    }
  }

  /** A shape for every obstacle, with pins for the pin classes its edges use. */
  private addShapes(session: LibavoidSession, model: GraphModel): Map<string, ShapeRef> {
    const pinClasses = new Map<string, Set<number>>();
    const use = (nodeId: string, sides: Side[] | undefined): void => {
      const classes = pinClasses.get(nodeId) ?? new Set();
      pinClasses.set(nodeId, classes.add(pinClass(sides)));
    };
    for (const edge of model.edges) {
      use(edge.source, edge.sourceSides);
      use(edge.target, edge.targetSides);
    }
    const shapes = new Map<string, ShapeRef>();
    for (const node of model.nodes.filter(isObstacle)) {
      const width = Math.max(node.width, MIN_SHAPE_SIZE);
      const height = Math.max(node.height, MIN_SHAPE_SIZE);
      const shape = session.addShape(node, width, height);
      for (const classId of pinClasses.get(node.id) ?? []) {
        for (const side of SIDES) if (classId & SIDE_BIT[side]) session.addPin(shape, classId, side);
      }
      shapes.set(node.id, shape);
    }
    return shapes;
  }

  /**
   * A connector per edge, from a pin class of its source to one of its target. An
   * endpoint-only node has no shape: the edge ends in the middle of its (allowed)
   * side facing the other end. `model.edges` must be routable, see routableEdges().
   */
  private addConnectors(
    session: LibavoidSession,
    shapes: Map<string, ShapeRef>,
    model: GraphModel,
  ): Map<string, ConnRef> {
    const nodes = nodesById(model);
    const end = (node: GraphNode, sides: Side[] | undefined, other: GraphNode): ConnEnd => {
      const shape = shapes.get(node.id);
      if (shape) return session.shapeEnd(shape, pinClass(sides));
      return session.pointEnd(sideMiddle(node, sideFacing(node, other, sides?.length ? sides : SIDES)));
    };
    const connectors = new Map<string, ConnRef>();
    for (const edge of model.edges) {
      const source = nodes.get(edge.source)!;
      const target = nodes.get(edge.target)!;
      const sourceEnd = end(source, edge.sourceSides, target);
      connectors.set(edge.id, session.connectEnds(sourceEnd, end(target, edge.targetSides, source)));
    }
    return connectors;
  }
}

/** The pin class of an edge end that may use these sides; none (or only invalid ones) = all four. */
function pinClass(sides: readonly Side[] | undefined): number {
  const allowed = sides?.length ? sides : SIDES;
  return allowed.reduce((bits, side) => bits | (SIDE_BIT[side] ?? 0), 0) || pinClass(undefined);
}

/**
 * Detours are worth it if they clearly reduce the overlaps without making the
 * routes much longer or crossing much more often. Overlaps weigh more than
 * crossings: they hide edges, crossings do not.
 */
function isBetter(next: RouteQuality, now: RouteQuality): boolean {
  return (
    next.overlap < (1 - MIN_OVERLAP_GAIN) * now.overlap &&
    next.length < (1 + MAX_EXTRA_LENGTH) * now.length &&
    next.crossings < (1 + MAX_EXTRA_CROSSINGS) * now.crossings + EXTRA_CROSSINGS_ALLOWED
  );
}
