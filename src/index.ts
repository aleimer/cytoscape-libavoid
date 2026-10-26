// Plugin wrapper: registers `cy.libavoid()` and keeps the routes of a Cytoscape
// graph up to date. Routing is done by EdgeRouter (routing.ts), styling by
// EdgeStyler (edge-style.ts).

import type cytoscapeFactory from 'cytoscape';
import type { Core, EdgeSingular, EventHandler } from 'cytoscape';
import { EdgeStyler } from './edge-style';
import { loadLibavoid, SIDES } from './libavoid';
import type { Avoid, Point, Side } from './libavoid';
import { defaultRoutingOptions, EdgeRouter, resolveRoutingOptions } from './routing';
import type { GraphModel, RoutingOptions } from './routing';

export { routeToEdgeStyle, edgeStyleToPoints, EdgeStyler } from './edge-style';
export type { EdgeSegmentStyle } from './edge-style';
export { loadLibavoid, LibavoidRouter } from './libavoid';
export type { Avoid, PinSpec, Point, RoutingOptionName, RoutingParameterName, RoutingType, Side } from './libavoid';
export { computeDockingPorts, defaultRoutingOptions, EdgeRouter, simplify, spreadPorts } from './routing';
export type {
  DockingPort,
  EdgePorts,
  FlowDirection,
  GraphEdge,
  GraphModel,
  GraphNode,
  RoutingOptions,
} from './routing';

const SCRATCH_KEY = '_libavoid';
const ROUTED_EVENT = 'avoidrouted';
const ERROR_EVENT = 'avoiderror';

export interface LibavoidOptions extends RoutingOptions {
  /** URL of libavoid.wasm as served by the app. Not needed in Node.js. Only the first load uses it. */
  wasmUrl?: string;
  /** An already loaded libavoid instance (`AvoidLib.getInstance()`); skips loading. */
  avoidLib?: Avoid;
  /** Selector of the edges to route. @default 'edge' */
  edges: string;
  /** Selector of the nodes that act as obstacles and edge endpoints. @default 'node:childless' */
  obstacles: string;
  /** Count node labels as part of the obstacle. @default false */
  includeLabels: boolean;
  /** Stroke width of an edge, used to space docking ports and parallel segments. @default the `width` style */
  edgeWidth: (edge: EdgeSingular) => number;
  /** 0 = sharp corners, > 0 = rounded corners with this radius (px). @default 0 */
  cornerRadius: number;
  /** Re-route automatically when elements are added, removed, moved or changed. @default true */
  live: boolean;
  /** With `live`: re-route continuously while a node is dragged; false = only on release. @default true */
  rerouteOnDrag: boolean;
  /**
   * With `rerouteOnDrag`: minimum pause between re-routes while a node is dragged (ms).
   * `'auto'` = as long as the last run took, so routing uses at most about half of the
   * time and dragging stays smooth on large graphs. 0 = re-route on every frame.
   * @default 'auto'
   */
  dragRouteInterval: number | 'auto';
}

/** Payload of the `avoidrouted` event. */
export interface RoutedEventInfo {
  edges: number;
  routingMs: number;
  totalMs: number;
}

export const defaults: Readonly<LibavoidOptions> = Object.freeze({
  ...defaultRoutingOptions,
  edges: 'edge',
  obstacles: 'node:childless',
  includeLabels: false,
  edgeWidth: (edge: EdgeSingular) => Number(edge.numericStyle('width')),
  cornerRadius: 0,
  live: true,
  rerouteOnDrag: true,
  dragRouteInterval: 'auto',
});

const nextFrame: (callback: () => void) => void =
  typeof requestAnimationFrame === 'function'
    ? (callback) => requestAnimationFrame(callback)
    : (callback) => setTimeout(callback, 0);

/** Routes the edges of one Cytoscape instance; created by `cy.libavoid(options)`. */
export class LibavoidRouting {
  readonly cy: Core;
  readonly options: LibavoidOptions;
  /** Resolves once libavoid is loaded and the first routing run is done. */
  readonly ready: Promise<LibavoidRouting>;

  private avoid: Avoid | undefined;
  private readonly styler: EdgeStyler;
  private currentRoutes = new Map<string, Point[]>();
  private destroyed = false;
  private routePending = false;
  /** The model of the last run, serialised, to skip re-routes when nothing moved. */
  private lastModelKey = '';
  /** End time and duration of the last run, for the pause between re-routes while dragging. */
  private lastRun = { end: 0, duration: 0 };
  private listeners: Array<[events: string, selector: string, handler: EventHandler]> = [];

  constructor(cy: Core, options: Partial<LibavoidOptions> = {}) {
    this.cy = cy;
    this.options = resolveRoutingOptions(defaults, options);
    this.styler = new EdgeStyler(cy);

    const libavoid = this.options.avoidLib
      ? Promise.resolve(this.options.avoidLib)
      : loadLibavoid(this.options.wasmUrl);
    this.ready = libavoid.then((avoid) => {
      if (this.destroyed) return this;
      this.avoid = avoid;
      if (this.options.live) this.startListening();
      this.route();
      return this;
    });
  }

  /** Edge id -> route points of the last run. */
  get routes(): ReadonlyMap<string, Point[]> {
    return this.currentRoutes;
  }

  /** Route points of an edge (element or id), or undefined if it is not routed. */
  getRoute(edge: EdgeSingular | string): Point[] | undefined {
    return this.currentRoutes.get(typeof edge === 'string' ? edge : edge.id());
  }

  /** Builds the plain graph model handed to the EdgeRouter. */
  model(): GraphModel {
    const { cy, options } = this;
    const nodes = cy.nodes(options.obstacles).filter((node) => node.visible());
    const nodeIds = new Set(nodes.map((node) => node.id()));
    const edges = cy
      .edges(options.edges)
      .toArray() // Collection.filter() loses the edge type
      .filter((edge) => edge.visible() && nodeIds.has(edge.source().id()) && nodeIds.has(edge.target().id()));

    return {
      nodes: nodes.map((node) => {
        const box = node.boundingBox({ includeLabels: options.includeLabels, includeOverlays: false });
        return { id: node.id(), x: (box.x1 + box.x2) / 2, y: (box.y1 + box.y2) / 2, width: box.w, height: box.h };
      }),
      edges: edges.map((edge) => ({
        id: edge.id(),
        source: edge.source().id(),
        target: edge.target().id(),
        width: Number(options.edgeWidth(edge)) || 0,
        sourceSide: parseSide(edge.data('sourceSide')),
        targetSide: parseSide(edge.data('targetSide')),
      })),
    };
  }

  /** Routes all edges now. */
  route(): ReadonlyMap<string, Point[]> {
    if (this.destroyed) return this.currentRoutes;
    if (!this.avoid) throw new Error('cytoscape-libavoid: not ready yet, await routing.ready first');
    return this.routeModel(this.avoid, this.model());
  }

  /**
   * Coalesces many change events into one re-route per animation frame, and
   * skips it when the routing input did not change: style / data events also
   * fire for changes that do not move anything, e.g. live data, or (with
   * compound nodes) for every node whenever edge styles are set. While a node
   * is dragged, re-routes are spaced out by `dragRouteInterval`.
   */
  scheduleRoute(): void {
    if (this.routePending || this.destroyed || !this.avoid) return;
    this.routePending = true;
    const runInNextFrame = () => nextFrame(() => this.runScheduledRoute());
    const pause = this.isDragging() ? this.dragPause() : 0;
    if (pause > 0) setTimeout(runInNextFrame, pause);
    else runInNextFrame();
  }

  /** Changes options and re-routes. */
  setOptions(options: Partial<LibavoidOptions>): this {
    const wasLive = this.options.live;
    Object.assign(this.options, options);
    if (!this.avoid) return this; // the first run picks the options up
    if (this.options.live && !wasLive) this.startListening();
    if (!this.options.live && wasLive) this.stopListening();
    this.route();
    return this;
  }

  /** Stops routing and restores the edges' own styles. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopListening();
    this.styler.clear();
    this.currentRoutes.clear();
    if (this.cy.scratch(SCRATCH_KEY) === this) this.cy.removeScratch(SCRATCH_KEY);
  }

  private routeModel(avoid: Avoid, model: GraphModel, modelKey = JSON.stringify(model)): ReadonlyMap<string, Point[]> {
    const start = performance.now();
    const routes = new EdgeRouter(avoid, this.options).route(model);
    this.lastModelKey = modelKey;
    const routed = performance.now();

    this.styler.apply(routes, this.options.cornerRadius);
    this.currentRoutes = routes;

    const end = performance.now();
    this.lastRun = { end, duration: end - start };
    const info: RoutedEventInfo = { edges: routes.size, routingMs: routed - start, totalMs: end - start };
    this.cy.emit(ROUTED_EVENT, [info]);
    return routes;
  }

  private runScheduledRoute(): void {
    this.routePending = false;
    if (this.destroyed || !this.avoid) return;
    // checked here, not per event: a drag also fires style events (compound parents); 'free' re-routes
    if (!this.options.rerouteOnDrag && this.isDragging()) return;
    const model = this.model();
    const modelKey = JSON.stringify(model);
    if (modelKey === this.lastModelKey) return;
    try {
      this.routeModel(this.avoid, model, modelKey);
    } catch (error) {
      this.lastModelKey = modelKey; // do not retry the same input on every following event
      this.cy.emit(ERROR_EVENT, [error]);
      console.error('cytoscape-libavoid: re-route failed', error);
    }
  }

  private isDragging(): boolean {
    return this.cy.nodes(':grabbed').nonempty();
  }

  /** How long to wait before the next re-route while dragging, see `dragRouteInterval`. */
  private dragPause(): number {
    const { dragRouteInterval } = this.options;
    const interval = dragRouteInterval === 'auto' ? this.lastRun.duration : dragRouteInterval;
    return this.lastRun.end + interval - performance.now();
  }

  private startListening(): void {
    if (this.listeners.length) return;
    const reroute = () => this.scheduleRoute();
    this.listen('add remove data', '*', reroute);
    this.listen('class style', 'node', reroute); // node size may depend on classes / styles
    this.listen('class', 'edge', reroute); // edge width may depend on classes
    this.listen('position', 'node', reroute); // rerouteOnDrag is checked in scheduleRoute()
    this.listen('free', 'node', reroute);
  }

  private stopListening(): void {
    for (const [events, selector, handler] of this.listeners) this.cy.off(events, selector, handler);
    this.listeners = [];
  }

  private listen(events: string, selector: string, handler: EventHandler): void {
    this.cy.on(events, selector, handler);
    this.listeners.push([events, selector, handler]);
  }
}

const parseSide = (value: unknown): Side | undefined => SIDES.find((side) => side === value);

declare module 'cytoscape' {
  interface Core {
    /**
     * With options: creates a new routing instance (replacing the previous one).
     * Without options: returns the current instance, creating it with defaults if needed.
     */
    libavoid(options?: Partial<LibavoidOptions>): LibavoidRouting;
  }
}

/** Cytoscape extension entry point: `cytoscape.use(cytoscapeLibavoid)` adds `cy.libavoid()`. */
export default function register(cytoscape: typeof cytoscapeFactory): void {
  cytoscape('core', 'libavoid', function (this: Core, options?: Partial<LibavoidOptions>): LibavoidRouting {
    const stored = this.scratch(SCRATCH_KEY);
    const current = stored instanceof LibavoidRouting ? stored : undefined;
    if (current && !options) return current;
    current?.destroy();
    const routing = new LibavoidRouting(this, options);
    this.scratch(SCRATCH_KEY, routing);
    return routing;
  });
}
