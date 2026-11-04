/**
 * Routing logic: turns a plain graph model into orthogonal routes. Knows
 * nothing about Cytoscape, so it can be tested in Node and reused with other
 * renderers.
 */

import type { Avoid, ConnEnd, ConnRef, ShapeRef } from '../libavoid/api';
import { LibavoidSession } from '../libavoid/libavoid-session';
import { findDetours } from '../postprocess/detour-finder';
import { separateOverlaps } from '../postprocess/overlap-separator';
import { RouteGeometry } from '../postprocess/route-geometry';
import { measureGeometry } from '../postprocess/route-quality';
import type { RouteQuality } from '../postprocess/route-quality';
import { simplify } from '../postprocess/simplify';
import { centreWidestEdges } from '../postprocess/widest-edge-centring';
import { sideCentre, sideFacing, SIDES } from '../shared/geometry';
import type { Point, Side } from '../shared/geometry';
import { isObstacle, nodesById, routableEdges } from '../shared/graph';
import type { GraphEdge, GraphModel, GraphNode } from '../shared/graph';
import { DEFAULT_ROUTING_OPTIONS, resolveRoutingOptions } from './options';
import type { RoutingOptions } from './options';

/**
 * Pins sit in the centre of a node's sides. An edge end's pin class is the sum of
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
/** Detoured routes are kept if their overlap is at least 20 % lower than the direct ones'... */
const MIN_RELATIVE_OVERLAP_DROP = 0.2;
/** ...they are at most 10 % longer... */
const MAX_RELATIVE_EXTRA_LENGTH = 0.1;
/** ...and they cross at most 50 % more often... */
const MAX_RELATIVE_EXTRA_CROSSINGS = 0.5;
/** ...plus 5 crossings, for graphs with few. */
const MAX_ABSOLUTE_EXTRA_CROSSINGS = 5;

/** Routes the edges of a graph model around its nodes with libavoid. */
export class EdgeRouter
{
  /** The options in use, merged onto {@link DEFAULT_ROUTING_OPTIONS} and frozen. */
  readonly options: RoutingOptions;
  /** The loaded libavoid instance every run uses. */
  private readonly avoid: Avoid;

  /**
   * @param avoid   initialised libavoid instance, see `loadLibavoid()`
   * @param options the options to change; the rest keep their defaults
   * @throws {Error} for invalid options, see {@link resolveRoutingOptions}
   */
  constructor(avoid: Avoid, options: Partial<RoutingOptions> = {})
  {
    this.avoid = avoid;
    this.options = resolveRoutingOptions(DEFAULT_ROUTING_OPTIONS, options);
  }

  /**
   * Routes once with libavoid, looks for edges that do not fit into crowded gaps
   * and spreads apart overlapping segments. If some edges need a detour, routes a
   * second time through checkpoints in wider gaps and keeps whichever result is
   * better (see {@link isBetter}). Finally the widest edge on a node side with more
   * than two edges moves to its centre, and the overlaps that causes are spread
   * apart again. Loops and edges with a missing end are skipped. Nodes and edges
   * are routed in the order of their ids: libavoid's results and the order the
   * post-processing steps visit node sides in depend on the input order, which
   * should not change the routes.
   *
   * @param model the graph to route; it is not changed
   * @returns edge id -> route points, from the source end to the target end
   */
  route(model: GraphModel): Map<string, Point[]>
  {
    const routable: GraphModel = { nodes: sortedById(model.nodes), edges: sortedById(routableEdges(model)) };
    const first = new RouteGeometry(this.routeOnce(routable), routable);
    const detours = this.options.detourCrowdedAreas ? this.detourCheckpoints(first) : new Map<string, Point>();
    this.separateIfEnabled(first);
    let result = first;
    if (detours.size > 0)
    {
      const second = new RouteGeometry(this.routeOnce(routable, detours), routable);
      this.separateIfEnabled(second);
      if (isBetter(measureGeometry(second), measureGeometry(first)))
      {
        result = second;
      }
    }
    centreWidestEdges(result, this.options.edgeSpacing);
    this.separateIfEnabled(result); // the reordered fans can put bends next to the node on top of each other
    return result.routes;
  }

  /**
   * Checkpoints for the edges that do not fit into crowded gaps, see {@link findDetours}.
   *
   * @param geometry the routes of the first run, before they are separated
   * @returns edge id -> checkpoint; at most {@link MAX_DETOUR_SHARE} of the edges
   */
  private detourCheckpoints(geometry: RouteGeometry): Map<string, Point>
  {
    const { edgeSpacing, shapeBufferDistance } = this.options;
    const maxDetours = Math.ceil(MAX_DETOUR_SHARE * geometry.model.edges.length);
    return findDetours(geometry, { spacing: edgeSpacing, clearance: shapeBufferDistance, maxDetours });
  }

  /**
   * With the option `separateOverlaps`: spreads apart overlapping segments, see {@link separateOverlaps}.
   *
   * @param geometry the routes to change in place
   */
  private separateIfEnabled(geometry: RouteGeometry): void
  {
    if (this.options.separateOverlaps)
    {
      separateOverlaps(geometry, this.options.edgeSpacing);
    }
  }

  /**
   * One libavoid run, with all its WebAssembly memory freed afterwards.
   *
   * @param model       the graph; its edges must be routable, see {@link routableEdges}
   * @param checkpoints edge id -> a point the edge must pass through
   * @returns edge id -> simplified route points
   */
  private routeOnce(model: GraphModel, checkpoints: ReadonlyMap<string, Point> = new Map()): Map<string, Point[]>
  {
    const session = new LibavoidSession(this.avoid);
    try
    {
      this.configure(session, model.edges);
      const shapes = this.addShapes(session, model);
      const connectors = this.addConnectors(session, shapes, model);
      for (const [edgeId, point] of checkpoints)
      {
        const connector = connectors.get(edgeId);
        if (connector)
        {
          session.setCheckpoints(connector, [point]);
        }
      }
      session.route();
      const routes = new Map<string, Point[]>();
      for (const [edgeId, connector] of connectors)
      {
        routes.set(edgeId, simplify(session.pointsOf(connector)));
      }
      return routes;
    }
    finally
    {
      session.dispose();
    }
  }

  /**
   * Sets libavoid's parameters from the options; the raw `routingParameters` /
   * `routingOptions` are set last, so they win.
   *
   * @param session the run to configure
   * @param edges   the edges of the run, for the widest stroke
   */
  private configure(session: LibavoidSession, edges: GraphEdge[]): void
  {
    const { options } = this;
    const widest = edges.reduce((max, edge) => Math.max(max, edge.width || 0), 0);
    const nudgingDistance = options.idealNudgingDistance === 'auto' ?
      Math.max(MIN_NUDGING_DISTANCE, widest + options.edgeSpacing) :
      options.idealNudgingDistance;

    session.setParameter('shapeBufferDistance', options.shapeBufferDistance);
    session.setParameter('idealNudgingDistance', nudgingDistance);
    session.setOption('nudgeOrthogonalSegmentsConnectedToShapes', options.nudgeConnectedSegments);
    /**
     * on in libavoid by default; it takes ~98 % of the routing time (64 nodes /
     * 112 edges: 3.4 s instead of 50 ms) for slightly fewer bends
     */
    session.setOption('performUnifyingNudgingPreprocessingStep', false);

    // raw values last, so they override everything above
    for (const [name, value] of Object.entries(options.routingParameters))
    {
      if (value !== undefined)
      {
        session.setParameter(name, value);
      }
    }
    for (const [name, value] of Object.entries(options.routingOptions))
    {
      if (value !== undefined)
      {
        session.setOption(name, value);
      }
    }
  }

  /**
   * Adds a shape for every obstacle, with pins for the pin classes its edges use.
   *
   * @param session the run to add them to
   * @param model   the graph; endpoint-only nodes get no shape
   * @returns node id -> shape, for the obstacles only
   */
  private addShapes(session: LibavoidSession, model: GraphModel): Map<string, ShapeRef>
  {
    const pinClasses = new Map<string, Set<number>>();
    // records that a node needs pins of the class for these sides; they are added with its shape below
    const notePinClass = (nodeId: string, sides: Side[] | undefined): void =>
    {
      const classes = pinClasses.get(nodeId) ?? new Set();
      pinClasses.set(nodeId, classes.add(pinClass(sides)));
    };
    for (const edge of model.edges)
    {
      notePinClass(edge.source, edge.sourceSides);
      notePinClass(edge.target, edge.targetSides);
    }
    const shapes = new Map<string, ShapeRef>();
    for (const node of model.nodes.filter(isObstacle))
    {
      const width = Math.max(node.width, MIN_SHAPE_SIZE);
      const height = Math.max(node.height, MIN_SHAPE_SIZE);
      const shape = session.addShape(node, width, height);
      for (const classId of pinClasses.get(node.id) ?? [])
      {
        for (const side of SIDES)
        {
          if (classId & SIDE_BIT[side])
          {
            session.addPin(shape, classId, side);
          }
        }
      }
      shapes.set(node.id, shape);
    }
    return shapes;
  }

  /**
   * Adds a connector per edge, from a pin class of its source to one of its target.
   * An endpoint-only node has no shape: the edge ends in the centre of its (allowed)
   * side facing the other end.
   *
   * @param session the run to add them to
   * @param shapes  node id -> shape, see {@link EdgeRouter.addShapes}
   * @param model   the graph; its edges must be routable, see {@link routableEdges}
   * @returns edge id -> connector
   */
  private addConnectors(
    session: LibavoidSession,
    shapes: Map<string, ShapeRef>,
    model: GraphModel,
  ): Map<string, ConnRef>
  {
    const nodes = nodesById(model);
    // the connector end at `node`: a pin class of its shape, or the side centre facing `other`
    const end = (node: GraphNode, sides: Side[] | undefined, other: GraphNode): ConnEnd =>
    {
      const shape = shapes.get(node.id);
      if (shape)
      {
        return session.shapeEnd(shape, pinClass(sides));
      }
      return session.pointEnd(sideCentre(node, sideFacing(node, other, sides?.length ? sides : SIDES)));
    };
    const connectors = new Map<string, ConnRef>();
    for (const edge of model.edges)
    {
      const source = nodes.get(edge.source)!;
      const target = nodes.get(edge.target)!;
      const sourceEnd = end(source, edge.sourceSides, target);
      connectors.set(edge.id, session.connectEnds(sourceEnd, end(target, edge.targetSides, source)));
    }
    return connectors;
  }
}

/**
 * The pin class of an edge end, see {@link SIDE_BIT}.
 *
 * @param sides the sides the end may use; none (or only invalid ones) = all four
 * @returns the sum of the sides' bits, 1 to 15
 */
function pinClass(sides: readonly Side[] | undefined): number
{
  const allowed = sides?.length ? sides : SIDES;
  return allowed.reduce((bits, side) => bits | (SIDE_BIT[side] ?? 0), 0) || pinClass(undefined);
}

/**
 * A copy sorted by id, so the routes do not depend on the input order, see {@link EdgeRouter.route}.
 *
 * @param items nodes or edges
 * @returns a new array, sorted by `id`
 */
function sortedById<T extends { id: string; }>(items: readonly T[]): T[]
{
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Whether detours are worth it: they clearly reduce the overlaps without making the
 * routes much longer or crossing much more often. Overlaps weigh more than
 * crossings: they hide edges, crossings do not.
 *
 * @param detoured the quality of the run through the detour checkpoints
 * @param direct   the quality of the run without them
 * @returns true if the detoured routes should be kept
 */
function isBetter(detoured: RouteQuality, direct: RouteQuality): boolean
{
  return (
    detoured.overlapLength < (1 - MIN_RELATIVE_OVERLAP_DROP) * direct.overlapLength &&
    detoured.length < (1 + MAX_RELATIVE_EXTRA_LENGTH) * direct.length &&
    detoured.crossings < (1 + MAX_RELATIVE_EXTRA_CROSSINGS) * direct.crossings + MAX_ABSOLUTE_EXTRA_CROSSINGS
  );
}
