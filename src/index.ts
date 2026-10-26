// Plugin wrapper: registers `cy.libavoid()` and keeps the routes of a Cytoscape
// graph up to date. Routing is done by EdgeRouter in this thread or by
// WorkerRouter in a Web Worker (both routing.ts), styling by EdgeStyler
// (edge-style.ts).

import type cytoscapeFactory from 'cytoscape';
import type { Core, EdgeSingular, EventHandler } from 'cytoscape';
import { EdgeStyler } from './edge-style';
import { loadLibavoid, SIDES } from './libavoid';
import type { Avoid, Point, Side } from './libavoid';
import { defaultRoutingOptions, EdgeRouter, pickRoutingOptions, resolveRoutingOptions, WorkerRouter } from './routing';
import type { GraphModel, RoutingOptions, RoutingWorker } from './routing';

export { routeToEdgeStyle, edgeStyleToPoints, EdgeStyler } from './edge-style';
export type { EdgeSegmentStyle } from './edge-style';
export { loadLibavoid, LibavoidRouter } from './libavoid';
export { findDetours, routeQuality, separateOverlaps } from './separation';
export type { DetourOptions, RouteQuality } from './separation';
export type { Avoid, PinSpec, Point, RoutingOptionName, RoutingParameterName, RoutingType, Side } from './libavoid';
export {
  answerRouteRequest,
  computeDockingPorts,
  defaultRoutingOptions,
  EdgeRouter,
  simplify,
  spreadPorts,
  WorkerRouter,
} from './routing';
export type {
  DockingPort,
  EdgePorts,
  FlowDirection,
  GraphEdge,
  GraphModel,
  GraphNode,
  RouteRequest,
  RouteResponse,
  RoutingOptions,
  RoutingWorker,
  WorkerRouteResult,
} from './routing';

const SCRATCH_KEY = '_libavoid';
const ROUTED_EVENT = 'avoidrouted';
const ERROR_EVENT = 'avoiderror';

export interface LibavoidOptions extends RoutingOptions {
  /** URL of libavoid.wasm as served by the app. Not needed in Node.js. Only the first load uses it. */
  wasmUrl?: string | undefined;
  /** An already loaded libavoid instance (`AvoidLib.getInstance()`); skips loading. Not used with `worker`. */
  avoidLib?: Avoid | undefined;
  /**
   * Route in this Web Worker (running routing.worker.ts) instead of the main thread,
   * so large graphs do not block rendering. `route()` is then not available; use `refresh()`.
   */
  worker?: RoutingWorker | undefined;
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
   * time and dragging stays smooth on large graphs (with a `worker`: no pause, the
   * next run starts when the worker is done). 0 = re-route on every frame.
   * @default 'auto'
   */
  dragRouteInterval: number | 'auto';
}

/** Payload of the `avoidrouted` event. */
export interface RoutedEventInfo {
  edges: number;
  /** Time spent in libavoid. */
  routingMs: number;
  /** From the start of the run to the styled edges; with a worker incl. the round trip. */
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

  /** libavoid in this thread; unset with a worker. */
  private avoid: Avoid | undefined;
  private readonly workerRouter: WorkerRouter | undefined;
  private readonly styler: EdgeStyler;
  private currentRoutes = new Map<string, Point[]>();
  private started = false;
  private destroyed = false;
  private routePending = false;
  /** The model of the last run, serialised, to skip re-routes when nothing moved. */
  private lastModelKey = '';
  /** The last run was a quicker one during a drag; the release routes once more in full. */
  private lastRunWasDraft = false;
  /** End time and duration of the last run, for the pause between re-routes while dragging. */
  private lastRun = { end: 0, duration: 0 };
  private listeners: Array<[events: string, selector: string, handler: EventHandler]> = [];

  /** The worker run in flight; one at a time. Settles (never rejects) once it is done. */
  private workerRun: Promise<void> | undefined;
  /** The graph or the options changed while a worker run was in flight. */
  private changedDuringWorkerRun = false;

  constructor(cy: Core, options: Partial<LibavoidOptions> = {}) {
    this.cy = cy;
    this.options = resolveRoutingOptions(defaults, options);
    this.styler = new EdgeStyler(cy);
    this.workerRouter = this.options.worker && new WorkerRouter(this.options.worker);
    cy.one('destroy', this.onGraphDestroyed);
    this.ready = this.start().then(() => this);
  }

  /** Edge id -> route points of the last run. */
  get routes(): ReadonlyMap<string, Point[]> {
    return this.currentRoutes;
  }

  /** Route points of an edge (element or id), or undefined if it is not routed. */
  getRoute(edge: EdgeSingular | string): Point[] | undefined {
    return this.currentRoutes.get(typeof edge === 'string' ? edge : edge.id());
  }

  /** Builds the plain graph model handed to the router. */
  model(): GraphModel {
    return this.buildModel(new Map());
  }

  /** Routes all edges now, in this thread. Not available with a `worker`, see refresh(). */
  route(): ReadonlyMap<string, Point[]> {
    if (this.destroyed) return this.currentRoutes;
    if (this.workerRouter) throw new Error('cytoscape-libavoid: route() is not available with a worker, use refresh()');
    if (!this.avoid) throw new Error('cytoscape-libavoid: not ready yet, await routing.ready first');
    return this.routeHere(this.avoid, this.snapshot());
  }

  /** Routes all edges now, in this thread or in the worker; with a worker after the run in flight. */
  async refresh(): Promise<ReadonlyMap<string, Point[]>> {
    if (this.destroyed) return this.currentRoutes;
    if (!this.workerRouter) return this.route();
    while (this.workerRun) await this.workerRun;
    await this.routeInWorker(this.snapshot());
    return this.currentRoutes;
  }

  /**
   * Coalesces many change events into one re-route per animation frame, and
   * skips it when the routing input did not change: style / data events also
   * fire for changes that do not move anything, e.g. live data, or (with
   * compound nodes) for every node whenever edge styles are set. While a node
   * is dragged, re-routes are spaced out by `dragRouteInterval`.
   */
  scheduleRoute(): void {
    if (this.routePending || this.destroyed || !this.started) return;
    this.routePending = true;
    const runInNextFrame = () => nextFrame(() => this.runScheduledRoute());
    const pause = this.isDragging() ? this.dragPause() : 0;
    if (pause > 0) setTimeout(runInNextFrame, pause);
    else runInNextFrame();
  }

  /** Changes options and re-routes. With a worker, errors arrive as `avoiderror` events. */
  setOptions(options: Partial<LibavoidOptions>): this {
    const wasLive = this.options.live;
    Object.assign(this.options, options);
    if (!this.started) return this; // the first run picks the options up
    if (this.options.live && !wasLive) this.startListening();
    if (!this.options.live && wasLive) this.stopListening();
    this.lastModelKey = ''; // the options are not part of the model, so force the next run
    if (!this.workerRouter) this.route();
    else if (this.workerRun) this.changedDuringWorkerRun = true;
    else this.routeInWorker(this.snapshot()).catch(this.reportError);
    return this;
  }

  /** Stops routing and restores the edges' own styles. A `worker` is left running. */
  destroy(): void {
    this.stop(true);
  }

  /** Loads libavoid (unless a worker does the routing), routes once, then listens for changes. */
  private async start(): Promise<void> {
    if (this.workerRouter) {
      try {
        await this.routeInWorker(this.snapshot());
      } catch (error) {
        if (!this.destroyed) throw error; // destroy() rejects the request in flight
      }
    } else {
      // always awaited, so the first run never happens inside the constructor
      this.avoid = await (this.options.avoidLib ?? loadLibavoid(this.options.wasmUrl));
      if (!this.destroyed) this.routeHere(this.avoid, this.snapshot());
    }
    if (this.destroyed) return;
    this.started = true;
    if (this.options.live) {
      this.startListening();
      if (this.workerRouter) this.scheduleRoute(); // picks up changes made during the first run
    }
  }

  private stop(restoreStyles: boolean): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cy.removeListener('destroy', this.onGraphDestroyed);
    this.stopListening();
    this.workerRouter?.dispose();
    this.currentRoutes.clear();
    if (!restoreStyles) return;
    this.styler.clear();
    if (this.cy.scratch(SCRATCH_KEY) === this) this.cy.removeScratch(SCRATCH_KEY);
  }

  /** `cy.destroy()` also ends the routing, so no pending re-route touches the destroyed graph. */
  private readonly onGraphDestroyed = (): void => this.stop(false); // the renderer is already gone

  private runScheduledRoute(): void {
    this.routePending = false;
    if (this.destroyed) return;
    // checked here, not per event: a drag also fires style events (compound parents); 'free' re-routes
    if (!this.options.rerouteOnDrag && this.isDragging()) return;
    if (this.workerRun) {
      this.changedDuringWorkerRun = true; // the model is built once the run in flight is done
      return;
    }
    const snapshot = this.snapshot();
    if (snapshot.key === this.lastModelKey && (snapshot.draft || !this.lastRunWasDraft)) return;
    if (this.workerRouter) {
      this.routeInWorker(snapshot).catch(this.reportError);
      return;
    }
    if (!this.avoid) return;
    try {
      this.routeHere(this.avoid, snapshot);
    } catch (error) {
      this.lastModelKey = snapshot.key; // do not retry the same input on every following event
      this.reportError(error);
    }
  }

  private routeHere(avoid: Avoid, snapshot: Snapshot): ReadonlyMap<string, Point[]> {
    const start = performance.now();
    const routes = new EdgeRouter(avoid, this.routingOptionsFor(snapshot)).route(snapshot.model);
    this.lastModelKey = snapshot.key;
    this.lastRunWasDraft = snapshot.draft;
    this.applyRoutes(routes, snapshot, performance.now() - start, start);
    return routes;
  }

  /** Routes in the worker; rejects if routing fails there. Changes in the meantime are routed afterwards. */
  private routeInWorker(snapshot: Snapshot): Promise<void> {
    const workerRouter = this.workerRouter!;
    this.lastModelKey = snapshot.key;
    this.lastRunWasDraft = snapshot.draft;
    const start = performance.now();
    const run = workerRouter
      .route({
        wasmUrl: absoluteUrl(this.options.wasmUrl),
        model: snapshot.model,
        options: pickRoutingOptions(this.routingOptionsFor(snapshot)),
      })
      .then(({ routes, routingMs }) => {
        if (!this.destroyed) this.applyRoutes(routes, snapshot, routingMs, start);
      });
    this.workerRun = run
      .catch(() => {}) // reported by the caller of routeInWorker()
      .then(() => {
        this.workerRun = undefined;
        if (!this.changedDuringWorkerRun) return;
        this.changedDuringWorkerRun = false;
        this.scheduleRoute();
      });
    return run;
  }

  private applyRoutes(routes: Map<string, Point[]>, snapshot: Snapshot, routingMs: number, start: number): void {
    this.styler.apply(routes, this.options.cornerRadius, snapshot.nodePositions);
    this.currentRoutes = routes;
    const end = performance.now();
    this.lastRun = { end, duration: end - start };
    const info: RoutedEventInfo = { edges: routes.size, routingMs, totalMs: end - start };
    this.cy.emit(ROUTED_EVENT, [info]);
  }

  /** The routing input now: the model, serialised for comparison, and the node positions. */
  private snapshot(): Snapshot {
    const nodePositions = new Map<string, Point>();
    const model = this.buildModel(nodePositions);
    return { model, key: JSON.stringify(model), nodePositions, draft: this.isDragging() };
  }

  /** While dragging, routes are drafts: without the slower detours around crowded gaps. */
  private routingOptionsFor(snapshot: Snapshot): LibavoidOptions {
    return snapshot.draft && this.options.detourCrowded ? { ...this.options, detourCrowded: false } : this.options;
  }

  /** @param nodePositions filled with the position of every node in the model */
  private buildModel(nodePositions: Map<string, Point>): GraphModel {
    const { cy, options } = this;
    const nodes = cy
      .nodes(options.obstacles)
      .toArray() // Collection.filter() loses the element type
      .filter((node) => node.visible());
    const nodeIds = new Set(nodes.map((node) => node.id()));
    const edges = cy
      .edges(options.edges)
      .toArray()
      .filter((edge) => edge.visible() && nodeIds.has(edge.source().id()) && nodeIds.has(edge.target().id()));

    return {
      nodes: nodes.map((node) => {
        const { x, y } = node.position();
        nodePositions.set(node.id(), { x, y });
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

  private readonly reportError = (error: unknown): void => {
    if (this.destroyed) return;
    this.cy.emit(ERROR_EVENT, [error]);
    console.error('cytoscape-libavoid: re-route failed', error);
  };

  private isDragging(): boolean {
    return this.cy.nodes(':grabbed').nonempty();
  }

  /** How long to wait before the next re-route while dragging, see `dragRouteInterval`. */
  private dragPause(): number {
    const { dragRouteInterval } = this.options;
    if (dragRouteInterval === 'auto' && this.workerRouter) return 0; // the main thread is not blocked
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

/** The routing input at one moment; the routes of a run are styled relative to its node positions. */
interface Snapshot {
  model: GraphModel;
  /** The model serialised, to compare with the last run. */
  key: string;
  nodePositions: Map<string, Point>;
  /** Taken while a node is dragged, see routingOptionsFor(). */
  draft: boolean;
}

/** A worker resolves relative URLs against its own script, so they are made absolute first. */
function absoluteUrl(url: string | undefined): string | undefined {
  if (url === undefined || typeof document === 'undefined') return url;
  return new URL(url, document.baseURI).href;
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
