/** Reads the routing input from a Cytoscape graph. */

import type { Core, EdgeSingular, NodeSingular } from 'cytoscape';
import { isSide, SIDES } from '../shared/geometry';
import type { Point, Side } from '../shared/geometry';
import type { GraphEdge, GraphModel, GraphNode } from '../shared/graph';
import type { LibavoidOptions } from './options';

/** The routing input at one moment. */
export interface Snapshot
{
  /** The graph to route, see {@link readModel}. */
  model: GraphModel;
  /** The model serialised: a run is skipped if it equals the last run's. */
  modelKey: string;
  /**
   * Cytoscape's position of every node in the model. The routes are anchored
   * relative to these, so routes that arrive late (from a worker) still start and
   * end at their nodes.
   */
  nodePositions: Map<string, Point>;
  /** Taken while a node is dragged: routing it may skip slow steps (a draft). */
  draft: boolean;
}

/** The options {@link readModel} uses. */
export type ModelOptions = Pick<LibavoidOptions, 'edges' | 'obstacles' | 'includeLabels' | 'edgeWidth' | 'edgeSides'>;

/**
 * The routing input now: the model, serialised for comparison, and the node positions.
 *
 * @param cy      the graph
 * @param options which elements to read and how, see {@link ModelOptions}
 * @param draft   true while a node is being dragged
 * @returns the snapshot
 */
export function takeSnapshot(cy: Core, options: ModelOptions, draft: boolean): Snapshot
{
  const nodePositions = new Map<string, Point>();
  const model = readModel(cy, options, nodePositions);
  return { model, modelKey: JSON.stringify(model), nodePositions, draft };
}

/**
 * Reads the graph to route: the visible obstacle nodes and the visible edges
 * between two visible nodes. An edge end that is no obstacle, e.g. a compound
 * node, is added as an endpoint-only node; edges between a compound node and a
 * node inside it are left out.
 *
 * @param cy            the graph
 * @param options       which elements to read and how, see {@link ModelOptions}
 * @param nodePositions filled with the position of every node in the model
 * @returns the plain graph model, in Cytoscape's element order
 */
export function readModel(cy: Core, options: ModelOptions, nodePositions: Map<string, Point> = new Map()): GraphModel
{
  const obstacles = cy
    .nodes(options.obstacles)
    .toArray() // Collection.filter() loses the element type
    .filter((node) => node.visible());
  const edges = cy.edges(options.edges).toArray().filter(isRoutable);
  const obstacleIds = new Set(obstacles.map((node) => node.id()));
  const endpoints = edges
    .flatMap((edge) => [edge.source(), edge.target()])
    .filter((node) => !obstacleIds.has(node.id()));

  // the model node of a Cytoscape node; also records its position
  const toNode = (node: NodeSingular, obstacle: boolean): GraphNode =>
  {
    const { x, y } = node.position();
    nodePositions.set(node.id(), { x, y });
    return graphNodeOf(node, obstacle, options.includeLabels);
  };
  return {
    nodes: [
      ...obstacles.map((node) => toNode(node, true)),
      ...uniqueById(endpoints).map((node) => toNode(node, false)),
    ],
    edges: edges.map((edge) => graphEdgeOf(edge, options)),
  };
}

/**
 * Whether an edge is routed at all.
 *
 * @param edge a Cytoscape edge
 * @returns true if it and both its nodes are visible and neither node is inside the other
 */
function isRoutable(edge: EdgeSingular): boolean
{
  const source = edge.source();
  const target = edge.target();
  return (
    edge.visible() &&
    source.visible() &&
    target.visible() &&
    !source.ancestors().anySame(target) &&
    !target.ancestors().anySame(source)
  );
}

/**
 * The model node of a Cytoscape node, from its bounding box, so its border counts.
 *
 * @param node          a Cytoscape node
 * @param obstacle      false for an endpoint-only node, see {@link GraphNode.obstacle}
 * @param includeLabels whether its label counts as part of it
 * @returns the rectangle around it
 */
function graphNodeOf(node: NodeSingular, obstacle: boolean, includeLabels: boolean): GraphNode
{
  const box = node.boundingBox({ includeLabels, includeOverlays: false });
  const centre = { x: (box.x1 + box.x2) / 2, y: (box.y1 + box.y2) / 2 };
  return { id: node.id(), ...centre, width: box.w, height: box.h, ...(obstacle ? {} : { obstacle: false }) };
}

/**
 * The model edge of a Cytoscape edge.
 *
 * @param edge    a routable Cytoscape edge, see {@link isRoutable}
 * @param options for its width and allowed sides
 * @returns its ends, width and side restrictions
 */
function graphEdgeOf(edge: EdgeSingular, options: ModelOptions): GraphEdge
{
  const sides = options.edgeSides?.(edge);
  const sourceSides = restrictedSides(sides?.source);
  const targetSides = restrictedSides(sides?.target);
  // left out rather than undefined when all four are allowed: the model is serialised for the modelKey
  return {
    id: edge.id(),
    source: edge.source().id(),
    target: edge.target().id(),
    width: Number(options.edgeWidth(edge)) || 0,
    ...(sourceSides && { sourceSides }),
    ...(targetSides && { targetSides }),
  };
}

/**
 * Cleans one end of an `edgeSides` result.
 *
 * @param sides one side, a list, or nothing
 * @returns the valid, distinct sides; undefined if that allows all four (or names none)
 */
function restrictedSides(sides: Side | readonly Side[] | undefined): Side[] | undefined
{
  const valid = [...new Set(typeof sides === 'string' ? [sides] : (sides ?? []))].filter(isSide);
  return valid.length && valid.length < SIDES.length ? valid : undefined;
}

/**
 * Drops repeated nodes, e.g. a compound node many edges end at.
 *
 * @param nodes Cytoscape nodes, maybe repeated
 * @returns each node once, in the order of its first appearance
 */
const uniqueById = (nodes: NodeSingular[]): NodeSingular[] => [
  ...new Map(nodes.map((node) => [node.id(), node])).values(),
];
