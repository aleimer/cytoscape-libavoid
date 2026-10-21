import type { Avoid, Point, RoutingOptionName, RoutingParameterName } from './libavoid.ts';
export type Side = 'top' | 'right' | 'bottom' | 'left';
export type FlowDirection = 'right' | 'left' | 'down' | 'up';
/** x/y are node centres. */
export interface GraphNode {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
}
export interface GraphEdge {
    id: string;
    source: string;
    target: string;
    width?: number;
    sourceSide?: Side;
    targetSide?: Side;
}
export interface GraphModel {
    nodes: GraphNode[];
    edges: GraphEdge[];
}
export interface RoutingOptions {
    routingType: 'orthogonal' | 'polyline';
    ports: 'auto' | 'sankey';
    flowDirection: FlowDirection;
    portSpacing: number;
    shapeBufferDistance: number;
    idealNudgingDistance: number | 'auto';
    nudgeConnectedSegments: boolean | 'auto';
    routingParameters: Partial<Record<RoutingParameterName, number>>;
    routingOptions: Partial<Record<RoutingOptionName, boolean>>;
}
/** offset is the proportional position (0..1) along the side. */
export interface SankeyPort {
    side: Side;
    offset: number;
}
export interface SankeyPorts {
    source: SankeyPort;
    target: SankeyPort;
}
export declare const DIR: {
    readonly up: 1;
    readonly down: 2;
    readonly left: 4;
    readonly right: 8;
    readonly all: 15;
};
export declare const SIDES: readonly Side[];
export declare const defaultRoutingOptions: RoutingOptions;
/**
 * Computes sankey-style port positions: every edge gets its own slot on the
 * outgoing side of its source and the incoming side of its target. Slots are
 * stacked by edge width and sorted by the position of the opposite node so
 * flows do not cross right at the node. Edges with unknown endpoints are skipped.
 *
 * @returns edge id -> source / target port
 */
export declare function computeSankeyPorts(model: GraphModel, opts: Partial<RoutingOptions>): Map<string, SankeyPorts>;
/**
 * Routes all edges of the model with libavoid.
 *
 * @param Avoid   initialised libavoid-js instance (AvoidLib.getInstance())
 * @param model   edges whose endpoints are missing or that are loops are skipped.
 * @param options see defaultRoutingOptions
 * @returns edge id -> route points (first = source end, last = target end)
 */
export declare function routeGraph(Avoid: Avoid, model: GraphModel, options?: Partial<RoutingOptions>): Map<string, Point[]>;
/** Rounds away float noise from libavoid and drops duplicate / collinear points. */
export declare function simplify(points: readonly Point[]): Point[];
//# sourceMappingURL=routing.d.ts.map