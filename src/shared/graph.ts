/**
 * The plain graph that routing works on: nodes as rectangles, edges between
 * them. Knows nothing about Cytoscape or libavoid.
 */

import type { Rect, Side } from './geometry';

/** A rectangle that edges route around (an obstacle) and that its own edges start or end at. */
export interface GraphNode extends Rect
{
  id: string;
  /**
   * false: only an endpoint, e.g. a compound node around other nodes. Its edges end
   * in the middle of the side facing their other end; other edges may cross it.
   * @default true
   */
  obstacle?: boolean | undefined;
}

/** A connection to route between two nodes, given by their ids. */
export interface GraphEdge
{
  id: string;
  source: string;
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
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** True unless the node is marked endpoint-only (`obstacle: false`). */
export const isObstacle = (node: GraphNode): boolean => node.obstacle !== false;

/** Node id -> node. */
export const nodesById = (model: GraphModel): Map<string, GraphNode> =>
  new Map(model.nodes.map((node) => [node.id, node]));

/** The edges routing handles: both ends exist and differ (no loops). */
export function routableEdges(model: GraphModel): GraphEdge[]
{
  const nodes = nodesById(model);
  return model.edges.filter((edge) => edge.source !== edge.target && nodes.has(edge.source) && nodes.has(edge.target));
}
