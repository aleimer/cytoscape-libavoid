// Reads the routing input from a Cytoscape graph.

import type { Core, EdgeSingular, NodeSingular } from 'cytoscape';
import { isSide, SIDES } from '../shared/geometry';
import type { Point, Side } from '../shared/geometry';
import type { GraphEdge, GraphModel, GraphNode } from '../shared/graph';
import type { LibavoidOptions } from './options';

/** The routing input at one moment. */
export interface Snapshot
{
  model: GraphModel;
  /** The model serialised: a run is skipped if it equals the last run's key. */
  key: string;
  /**
   * Cytoscape's position of every node in the model. EdgeStyler anchors the routes
   * relative to these, so routes that arrive late (from a worker) still start and
   * end at their nodes.
   */
  nodePositions: Map<string, Point>;
  /** Taken while a node is dragged: the run is a quicker draft, see LibavoidRouting. */
  draft: boolean;
}

/** The options readModel() uses. */
export type ModelOptions = Pick<LibavoidOptions, 'edges' | 'obstacles' | 'includeLabels' | 'edgeWidth' | 'edgeSides'>;

/**
 * The routing input now: the model, serialised for comparison, and the node positions.
 *
 * @param draft a node is being dragged
 */
export function takeSnapshot(cy: Core, options: ModelOptions, draft: boolean): Snapshot
{
  const nodePositions = new Map<string, Point>();
  const model = readModel(cy, options, nodePositions);
  return { model, key: JSON.stringify(model), nodePositions, draft };
}

/**
 * The visible obstacle nodes and the visible edges between two visible nodes. An
 * edge end that is no obstacle, e.g. a compound node, is added as an endpoint-only
 * node; edges between a compound node and a node inside it are left out.
 *
 * @param nodePositions filled with the position of every node in the model
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

/** Visible, between two visible nodes, neither inside the other. */
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

/** The node's bounding box, so its border (and with `includeLabels` its label) counts. */
function graphNodeOf(node: NodeSingular, obstacle: boolean, includeLabels: boolean): GraphNode
{
  const box = node.boundingBox({ includeLabels, includeOverlays: false });
  const centre = { x: (box.x1 + box.x2) / 2, y: (box.y1 + box.y2) / 2 };
  return { id: node.id(), ...centre, width: box.w, height: box.h, ...(obstacle ? {} : { obstacle: false }) };
}

function graphEdgeOf(edge: EdgeSingular, options: ModelOptions): GraphEdge
{
  const sides = options.edgeSides?.(edge);
  return {
    id: edge.id(),
    source: edge.source().id(),
    target: edge.target().id(),
    width: Number(options.edgeWidth(edge)) || 0,
    ...sidesOf('sourceSides', sides?.source),
    ...sidesOf('targetSides', sides?.target),
  };
}

/** `{ [key]: valid sides }`, or nothing if all four are allowed. */
function sidesOf(key: 'sourceSides' | 'targetSides', sides: Side | readonly Side[] | undefined): Partial<GraphEdge>
{
  const valid = [...new Set(typeof sides === 'string' ? [sides] : (sides ?? []))].filter(isSide);
  return valid.length && valid.length < SIDES.length ? { [key]: valid } : {};
}

const uniqueById = (nodes: NodeSingular[]): NodeSingular[] => [
  ...new Map(nodes.map((node) => [node.id(), node])).values(),
];
