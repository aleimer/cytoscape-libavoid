import type cytoscapeFactory from 'cytoscape';
import type { Core, EdgeSingular } from 'cytoscape';
import type { GraphModel, RoutingOptions } from './routing.ts';
import type { Avoid, Point } from './libavoid.ts';
export { routeGraph, computeSankeyPorts, simplify } from './routing.ts';
export type { FlowDirection, GraphEdge, GraphModel, GraphNode, RoutingOptions, SankeyPort, SankeyPorts, Side } from './routing.ts';
export { routeToEdgeStyle, edgeStyleToPoints } from './edge-style.ts';
export type { EdgeSegmentStyle } from './edge-style.ts';
export type { Avoid, Point, RoutingOptionName, RoutingParameterName } from './libavoid.ts';
export interface LibavoidOptions extends RoutingOptions {
    wasmUrl?: string;
    avoidLib?: Avoid;
    edges: string;
    obstacles: string;
    includeLabels: boolean;
    edgeWidth: (edge: EdgeSingular) => number;
    cornerRadius: number;
    live: boolean;
    rerouteOnDrag: boolean;
}
/** Payload of the `avoidrouted` event. */
export interface RoutedEventInfo {
    edges: number;
    routingMs: number;
    totalMs: number;
}
export declare const defaults: LibavoidOptions;
/** Loads the libavoid WebAssembly module once and caches the instance. */
export declare function loadLibavoid(wasmUrl?: string): Promise<Avoid>;
export declare class LibavoidRouting {
    readonly cy: Core;
    readonly options: LibavoidOptions;
    readonly ready: Promise<LibavoidRouting>;
    Avoid: Avoid | null;
    routes: Map<string, Point[]>;
    styled: Set<string>;
    destroyed: boolean;
    private _pending;
    private _listeners;
    constructor(cy: Core, options?: Partial<LibavoidOptions>);
    /** Builds the plain graph model handed to the routing core. */
    model(): GraphModel;
    /** Routes all edges now. Returns a Map edge id -> route points. */
    route(): Map<string, Point[]>;
    /** Coalesces many change events into one re-route per animation frame. */
    scheduleRoute(): void;
    /** Route points of an edge (edge element or id), or undefined if not routed. */
    getRoute(edge: EdgeSingular | string): Point[] | undefined;
    /** Changes options and re-routes. */
    setOptions(options: Partial<LibavoidOptions>): this;
    /** Stops routing and restores the edges' own styles. */
    destroy(): void;
    private _on;
    private _bind;
    private _unbind;
}
declare module 'cytoscape' {
    interface Core {
        /**
         * Calling it with options replaces the previous instance; without
         * options it returns the current one (creating it with defaults if needed).
         */
        libavoid(options?: Partial<LibavoidOptions>): LibavoidRouting;
    }
}
/**
 * Cytoscape extension entry point: `cytoscape.use(cytoscapeLibavoid)`.
 * Adds `cy.libavoid(options)` which returns a LibavoidRouting instance.
 * Calling it again with options replaces the previous instance; without
 * options it returns the current one (creating it with defaults if needed).
 */
export default function register(cytoscape: typeof cytoscapeFactory | undefined): void;
//# sourceMappingURL=index.d.ts.map