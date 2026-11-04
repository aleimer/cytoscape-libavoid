/**
 * The plain graph that routing works on: nodes as rectangles, edges between
 * them. Knows nothing about Cytoscape or libavoid.
 */

import type { Rect, Side } from './geometry';

/** A rectangle that edges route around (an obstacle) and that its own edges start or end at. */
export interface GraphNode extends Rect
{
  /** Unique among the nodes; edges refer to it. */
  id: string;
  /**
   * false: only an endpoint, e.g. a compound node around other nodes. Its edges end
   * in the centre of the side facing their other end; other edges may cross it.
   * @default true
   */
  obstacle?: boolean | undefined;
}

/** A connection to route between two nodes, given by their ids. */
export interface GraphEdge
{
  /** Unique among the edges; the routes are keyed by it. */
  id: string;
  /** {@link GraphNode.id} of the node the edge starts at. */
  source: string;
  /** {@link GraphNode.id} of the node the edge ends at. */
  target: string;
  /** Stroke width (px), used to space parallel segments. @default 0 */
  width?: number | undefined;
  /** The sides of the source node the edge may leave from. @default all four */
  sourceSides?: Side[] | undefined;
  /** The sides of the target node the edge may end at. @default all four */
  targetSides?: Side[] | undefined;
}

/** The input of routing: positions and sizes in model coordinates. */
export interface GraphModel
{
  /** The obstacles and endpoint-only nodes. */
  nodes: GraphNode[];
  /** The edges to route; see {@link routableEdges} for the ones that are. */
  edges: GraphEdge[];
}

/**
 * Whether edges route around the node.
 *
 * @param node a node of the model
 * @returns true unless the node is marked endpoint-only (`obstacle: false`)
 */
export const isObstacle = (node: GraphNode): boolean => node.obstacle !== false;

/**
 * Looks up nodes by id.
 *
 * @param model the graph
 * @returns node id -> node
 */
export const nodesById = (model: GraphModel): Map<string, GraphNode> =>
  new Map(model.nodes.map((node) => [node.id, node]));

/**
 * The edges routing handles: both ends exist and differ (no loops).
 *
 * @param model the graph
 * @returns the routable edges, in model order
 */
export function routableEdges(model: GraphModel): GraphEdge[]
{
  const nodes = nodesById(model);
  return model.edges.filter((edge) => edge.source !== edge.target && nodes.has(edge.source) && nodes.has(edge.target));
}
