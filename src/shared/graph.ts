// The plain graph that routing works on: nodes as rectangles, edges between
// them. Knows nothing about Cytoscape or libavoid.

import type { Rect, Side } from './geometry';

/** A node: obstacle for all edges and endpoint of its own. */
export interface GraphNode extends Rect {
  id: string;
  /**
   * false: only an endpoint, e.g. a compound node around other nodes. Its edges end
   * in the middle of the side facing their other end; other edges may cross it.
   * @default true
   */
  obstacle?: boolean | undefined;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  /** Stroke width, used to space parallel segments. */
  width?: number | undefined;
  /** The sides of the source node the edge may leave from. @default all four */
  sourceSides?: Side[] | undefined;
  /** The sides of the target node the edge may end at. @default all four */
  targetSides?: Side[] | undefined;
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const isObstacle = (node: GraphNode): boolean => node.obstacle !== false;

/** Node id -> node. */
export const nodesById = (model: GraphModel): Map<string, GraphNode> =>
  new Map(model.nodes.map((node) => [node.id, node]));

/** Edges whose endpoints both exist and differ. */
export function routableEdges(model: GraphModel): GraphEdge[] {
  const nodes = nodesById(model);
  return model.edges.filter((edge) => edge.source !== edge.target && nodes.has(edge.source) && nodes.has(edge.target));
}
