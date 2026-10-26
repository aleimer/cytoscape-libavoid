// Plugin wrapper: registers `cy.libavoid()` and keeps the routes of a Cytoscape
// graph up to date. Routing is done by EdgeRouter (routing.ts) in this thread
// or in a Web Worker (routing.worker.ts), styling by EdgeStyler (edge-style.ts).

import type cytoscapeFactory from 'cytoscape';
import type { Core, EdgeSingular, EventHandler } from 'cytoscape';
import { EdgeStyler } from './edge-style';
import { loadLibavoid, SIDES } from './libavoid';
import type { Avoid, Point, Side } from './libavoid';
import { defaultRoutingOptions, EdgeRouter, pickRoutingOptions, resolveRoutingOptions } from './routing';
import type { GraphModel, RouteRequest, RouteResponse, RoutingOptions } from './routing';

export { routeToEdgeStyle, edgeStyleToPoints, EdgeStyler } from './edge-style';
export type { EdgeSegmentStyle } from './edge-style';
export { loadLibavoid, LibavoidRouter } from './libavoid';
export type { Avoid, PinSpec, Point, RoutingOptionName, RoutingParameterName, RoutingType, Side } from './libavoid';
export {
  answerRouteRequest,
  computeDockingPorts,
  defaultRoutingOptions,
  EdgeRouter,
  simplify,
  spreadPorts,
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
} from './routing';

const SCRATCH_KEY = '_libavoid';
const ROUTED_EVENT = 'avoidrouted';
const ERROR_EVENT = 'avoiderror';

/** The part of a Web Worker the plugin uses; a `Worker` running routing.worker.ts fits. */
export interface RoutingWorker {
  postMessage(request: RouteRequest): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<RouteResponse>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<RouteResponse>) => void): void;
}

export interface LibavoidOptions extends RoutingOptions {
  /** URL of libavoid.wasm as served by the app. Not needed in Node.js. Only the first load uses it. */
  wasmUrl?: string;
  /** An already loaded libavoid instance (`AvoidLib.getInstance()`); skips loading. Not used with `worker`. */
  avoidLib?: Avoid;
  /**
   * Route in this Web Worker (running routing.worker.ts) instead of the main thread,
   * so large graphs do not block rendering. `route()` is then not available; use `refresh()`.
   */
  worker?: RoutingWorker;
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

/** Request ids are unique across instances, so several instances can share one worker. */
let lastRequestId = 0;

/** Routes the edges of one Cytoscape instance; created by `cy.libavoid(options)`. */
export class LibavoidRouting {
  readonly cy: Core;
  readonly options: LibavoidOptions;
  /** Resolves once libavoid is loaded and the first routing run is done. */
  readonly ready: Promise<LibavoidRouting>;

  private avoid: Avoid | undefined;
  private readonly worker: RoutingWorker | undefined;
  private readonly styler: EdgeStyler;
  private currentRoutes = new Map<string, Point[]>();
  private started = false;
  private destroyed = false;
  private routePending = false;
  /** The model of the last run, serialised, to skip re-routes when nothing moved. */
  private lastModelKey = '';
  /** End time and duration of the last run, for the pause between re-routes while dragging. */
  private lastRun = { end: 0, duration: 0 };
  private listeners: Array<[events: string, selector: string, handler: EventHandler]> = [];

  /** The worker request in flight; one at a time, changes in between are sent when it is answered. */
  private workerRequest: { id: number; start: number; snapshot: Snapshot; callers: Settle[] } | undefined;
  /** Callers that asked for a result while a request was in flight; they get the next one. */
  private callersForNextRequest: Settle[] = [];
  /** The graph changed while a worker request was in flight. */
  private changedDuringRequest = false;

  constructor(cy: Core, options: Partial<LibavoidOptions> = {}) {
    this.cy = cy;
    this.options = resolveRoutingOptions(defaults, options);
    this.styler = new EdgeStyler(cy);
    this.worker = this.options.worker;
    cy.one('destroy', this.onGraphDestroyed);

    if (this.worker) {
      this.worker.addEventListener('message', this.onWorkerMessage);
      this.ready = this.start().then(() => this);
    } else {
      const libavoid = this.options.avoidLib
        ? Promise.resolve(this.options.avoidLib)
        : loadLibavoid(this.options.wasmUrl);
      this.ready = libavoid.then((avoid) => {
        this.avoid = avoid;
        return this.start().then(() => this);
      });
    }
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
    return this.buildModel(new Map());
  }

  /** Routes all edges now, in this thread. Not available with a `worker`, see refresh(). */
  route(): ReadonlyMap<string, Point[]> {
    if (this.destroyed) return this.currentRoutes;
    if (this.worker) throw new Error('cytoscape-libavoid: route() is not available with a worker, use refresh()');
    if (!this.avoid) throw new Error('cytoscape-libavoid: not ready yet, await routing.ready first');
    return this.routeHere(this.avoid, this.snapshot());
  }

  /** Routes all edges now, in this thread or in the worker. */
  refresh(): Promise<ReadonlyMap<string, Point[]>> {
    if (this.destroyed) return Promise.resolve(this.currentRoutes);
    if (!this.worker) {
      try {
        return Promise.resolve(this.route());
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return new Promise((resolve, reject) => {
      this.requestFromWorker(this.snapshot(), [{ resolve: () => resolve(this.currentRoutes), reject }]);
    });
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
    this.lastModelKey = ''; // the options are not part of the model: a request in flight is followed by a new one
    if (this.worker) this.requestFromWorker(this.snapshot());
    else this.route();
    return this;
  }

  /** Stops routing and restores the edges' own styles. A `worker` is left running. */
  destroy(): void {
    this.stop(true);
  }

  private stop(restoreStyles: boolean): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cy.removeListener('destroy', this.onGraphDestroyed);
    this.stopListening();
    this.worker?.removeEventListener('message', this.onWorkerMessage);
    for (const caller of [...(this.workerRequest?.callers ?? []), ...this.callersForNextRequest]) caller.resolve();
    this.workerRequest = undefined;
    this.callersForNextRequest = [];
    this.currentRoutes.clear();
    if (!restoreStyles) return;
    this.styler.clear();
    if (this.cy.scratch(SCRATCH_KEY) === this) this.cy.removeScratch(SCRATCH_KEY);
  }

  /** `cy.destroy()` also ends the routing, so no pending re-route touches the destroyed graph. */
  private readonly onGraphDestroyed = (): void => this.stop(false); // the renderer is already gone

  /** First run, then listening for changes. */
  private async start(): Promise<void> {
    if (this.destroyed) return;
    if (this.worker) {
      await new Promise<void>((resolve, reject) => this.requestFromWorker(this.snapshot(), [{ resolve, reject }]));
    } else if (this.avoid) {
      this.routeHere(this.avoid, this.snapshot());
    }
    if (this.destroyed) return;
    this.started = true;
    if (this.options.live) {
      this.startListening();
      if (this.worker) this.scheduleRoute(); // picks up changes made while the first run was in the worker
    }
  }

  private runScheduledRoute(): void {
    this.routePending = false;
    if (this.destroyed) return;
    // checked here, not per event: a drag also fires style events (compound parents); 'free' re-routes
    if (!this.options.rerouteOnDrag && this.isDragging()) return;
    if (this.workerRequest) {
      this.changedDuringRequest = true; // the model is built when the request is answered
      return;
    }
    const snapshot = this.snapshot();
    if (snapshot.key === this.lastModelKey) return;
    if (this.worker) {
      this.requestFromWorker(snapshot);
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
    const routes = new EdgeRouter(avoid, this.options).route(snapshot.model);
    this.lastModelKey = snapshot.key;
    this.applyRoutes(routes, snapshot, performance.now() - start, start);
    return routes;
  }

  /** Sends the model to the worker, or remembers to do so once the request in flight is answered. */
  private requestFromWorker(snapshot: Snapshot, callers: Settle[] = []): void {
    if (!this.worker || this.destroyed) {
      for (const caller of callers) caller.resolve();
      return;
    }
    if (this.workerRequest) {
      this.changedDuringRequest = true;
      this.callersForNextRequest.push(...callers);
      return;
    }
    this.lastModelKey = snapshot.key;
    const request: RouteRequest = {
      id: ++lastRequestId,
      wasmUrl: absoluteUrl(this.options.wasmUrl),
      model: snapshot.model,
      options: pickRoutingOptions(this.options),
    };
    this.workerRequest = { id: request.id, start: performance.now(), snapshot, callers };
    this.worker.postMessage(request);
  }

  private readonly onWorkerMessage = (event: MessageEvent<RouteResponse>): void => {
    const response = event.data;
    const request = this.workerRequest;
    if (!request || response.id !== request.id) return; // another instance's request
    this.workerRequest = undefined;

    if ('error' in response) {
      const error = new Error(`cytoscape-libavoid: ${response.error.replace(/^cytoscape-libavoid: /, '')}`);
      if (request.callers.length) for (const caller of request.callers) caller.reject(error);
      else this.reportError(error);
    } else {
      this.applyRoutes(new Map(response.routes), request.snapshot, response.routingMs, request.start);
      for (const caller of request.callers) caller.resolve();
    }

    const changed = this.changedDuringRequest;
    this.changedDuringRequest = false;
    const waiting = this.callersForNextRequest;
    this.callersForNextRequest = [];
    if (waiting.length) {
      // they asked after this request was sent, so they get a fresh one even if nothing moved
      this.requestFromWorker(this.snapshot(), waiting);
    } else if (changed) {
      this.scheduleRoute();
    }
  };

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
    return { model, key: JSON.stringify(model), nodePositions };
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

  private reportError(error: unknown): void {
    this.cy.emit(ERROR_EVENT, [error]);
    console.error('cytoscape-libavoid: re-route failed', error);
  }

  private isDragging(): boolean {
    return this.cy.nodes(':grabbed').nonempty();
  }

  /** How long to wait before the next re-route while dragging, see `dragRouteInterval`. */
  private dragPause(): number {
    const { dragRouteInterval } = this.options;
    if (dragRouteInterval === 'auto' && this.worker) return 0; // the main thread is not blocked
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
}

/** Callbacks of a caller waiting for a worker result. */
interface Settle {
  resolve(): void;
  reject(error: unknown): void;
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
