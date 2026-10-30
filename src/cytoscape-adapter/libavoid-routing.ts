// Keeps the routes of a Cytoscape graph up to date. Routing is done by a
// RoutingBackend (in this thread or in a Web Worker), styling by EdgeStyler,
// timing by RouteScheduler.

import type { Core, EdgeSingular, EventHandler, NodeSingular } from 'cytoscape';
import { pluginMessage } from '../shared/errors';
import type { Point } from '../shared/geometry';
import type { GraphModel } from '../shared/graph';
import { loadLibavoid } from '../libavoid/load';
import type { RoutingBackend } from '../routing/routing-backend';
import { LocalRouter } from '../routing/local-router';
import { WorkerRouter } from '../worker/worker-router';
import { DragTracker } from './drag-tracker';
import { EdgeStyler } from './edge-styler';
import { resolveOptions } from './options';
import type { LibavoidOptions, RoutedEventInfo } from './options';
import { RouteScheduler } from './route-scheduler';
import { readModel, takeSnapshot } from './snapshot';
import type { Snapshot } from './snapshot';

/** Where `cy.libavoid()` keeps the instance, in `cy.scratch()`. */
export const SCRATCH_KEY = '_libavoid';
const ROUTED_EVENT = 'avoidrouted';
const ERROR_EVENT = 'avoiderror';

/** Routes the edges of one Cytoscape instance; created by `cy.libavoid(options)`. */
export class LibavoidRouting {
  readonly cy: Core;
  /** Resolves once libavoid is loaded and the first routing run is done. */
  readonly ready: Promise<LibavoidRouting>;

  private currentOptions: Readonly<LibavoidOptions>;
  private readonly backend: RoutingBackend;
  private readonly styler: EdgeStyler;
  private readonly scheduler: RouteScheduler;
  private readonly drag = new DragTracker();
  /**
   * starting: the first run is not done yet; nothing listens to changes.
   * running: listening (with `live`) and routing changes.
   * destroyed: no more runs; answers still in flight are dropped.
   */
  private state: 'starting' | 'running' | 'destroyed' = 'starting';
  private currentRoutes = new Map<string, Point[]>();
  /** The run in flight; one at a time. Settles (never rejects) once it is done. */
  private inFlight: Promise<void> | undefined;
  /** Something changed while a run was in flight: route again afterwards. */
  private rerun = false;
  /**
   * The last run: its model serialised, to skip runs when nothing moved; whether it
   * was a draft during a drag, so the release routes once more in full; and its end
   * and duration, for the pause between runs while dragging.
   */
  private last = { modelKey: '', draft: false, end: 0, duration: 0 };
  /** The Cytoscape listeners added by startListening(), to remove them again. */
  private listeners: Array<[events: string, selector: string, handler: EventHandler]> = [];

  constructor(cy: Core, options: Partial<LibavoidOptions> = {}) {
    this.cy = cy;
    this.currentOptions = resolveOptions(options);
    const { worker, wasmUrl, avoidLib } = this.currentOptions;
    this.backend = worker
      ? new WorkerRouter(worker, absoluteUrl(wasmUrl))
      : new LocalRouter(avoidLib ?? loadLibavoid(wasmUrl));
    this.styler = new EdgeStyler(cy);
    this.scheduler = new RouteScheduler(
      {
        dragging: () => this.drag.active,
        restDelay: () => this.currentOptions.dragRouteDelay,
        pause: () => this.dragPause(),
      },
      () => this.runScheduledRoute(),
    );
    cy.one('destroy', this.onGraphDestroyed);
    this.ready = this.start().then(() => this);
  }

  /** The options in use (frozen); change them with setOptions(). */
  get options(): Readonly<LibavoidOptions> {
    return this.currentOptions;
  }

  /** Edge id -> route points of the last run. */
  get routes(): ReadonlyMap<string, Point[]> {
    return this.currentRoutes;
  }

  /** Route points of an edge (element or id), or undefined if it is not routed. */
  getRoute(edge: EdgeSingular | string): Point[] | undefined {
    return this.currentRoutes.get(typeof edge === 'string' ? edge : edge.id());
  }

  /** The plain graph model routing gets now, e.g. to see why an edge is not routed. */
  model(): GraphModel {
    return readModel(this.cy, this.currentOptions);
  }

  /** Routes all edges now, after the run in flight; rejects if routing fails. */
  async refresh(): Promise<ReadonlyMap<string, Point[]>> {
    while (this.inFlight) await this.inFlight;
    if (this.state !== 'destroyed') await this.run(this.snapshot());
    return this.currentRoutes;
  }

  /**
   * Coalesces many change events into one re-route per animation frame, and
   * skips it when the routing input did not change: style / data events also
   * fire for changes that do not move anything, e.g. live data, or (with
   * compound nodes) for every node whenever edge styles are set. While a node
   * is dragged, re-routes wait for `dragRouteDelay` and are spaced out by
   * `dragRouteInterval`.
   */
  scheduleRoute(): void {
    if (this.state === 'running') this.scheduler.schedule();
  }

  /**
   * Changes options and re-routes. Invalid options throw; routing errors arrive as
   * `avoiderror` events. `worker`, `wasmUrl` and `avoidLib` only count on creation.
   */
  setOptions(options: Partial<LibavoidOptions>): this {
    const wasLive = this.currentOptions.live;
    this.currentOptions = resolveOptions({ ...this.currentOptions, ...options });
    if (this.state !== 'running') return this; // the first run picks the options up
    if (this.currentOptions.live && !wasLive) this.startListening();
    if (!this.currentOptions.live && wasLive) this.stopListening();
    this.last.modelKey = ''; // the options are not part of the model, so force the next run
    if (this.inFlight) this.rerun = true;
    else this.run(this.snapshot()).catch(this.reportError);
    return this;
  }

  /** Stops routing and restores the edges' own styles. A `worker` is left running. */
  destroy(): void {
    this.stop(true);
  }

  /** Routes once (loading libavoid unless a worker does the routing), then listens for changes. */
  private async start(): Promise<void> {
    await Promise.resolve(); // never route inside the constructor
    try {
      if (this.state !== 'destroyed') await this.run(this.snapshot());
    } catch (error) {
      if (this.state !== 'destroyed') throw error; // destroy() rejects the run in flight
    }
    if (this.state === 'destroyed') return;
    this.state = 'running';
    if (!this.currentOptions.live) return;
    this.startListening();
    // changes made while the first run was in flight, e.g. with a worker, were not heard
    if (this.snapshot().key !== this.last.modelKey) this.scheduleRoute();
  }

  /** @param restoreStyles false when the graph itself is destroyed: its renderer is already gone */
  private stop(restoreStyles: boolean): void {
    if (this.state === 'destroyed') return;
    this.state = 'destroyed';
    this.scheduler.stop();
    this.cy.removeListener('destroy', this.onGraphDestroyed);
    this.stopListening();
    this.backend.dispose();
    this.currentRoutes.clear();
    if (!restoreStyles) return;
    this.styler.clear();
    if (this.cy.scratch(SCRATCH_KEY) === this) this.cy.removeScratch(SCRATCH_KEY);
  }

  /** `cy.destroy()` also ends the routing, so no pending re-route touches the destroyed graph. */
  private readonly onGraphDestroyed = (): void => this.stop(false);

  /**
   * The run the scheduler asks for. Waits while dragging without `rerouteOnDrag`,
   * for the run in flight, and is skipped if the input did not change.
   */
  private runScheduledRoute(): void {
    // checked here, not per event: a drag also fires style events (compound parents); 'free' re-routes
    if (!this.currentOptions.rerouteOnDrag && this.drag.active) return;
    if (this.inFlight) {
      this.rerun = true; // the snapshot is taken once the run in flight is done
      return;
    }
    const snapshot = this.snapshot();
    if (snapshot.key === this.last.modelKey && (snapshot.draft || !this.last.draft)) {
      this.styler.reveal(snapshot.nodePositions); // e.g. a node dragged back to where it was routed
      return;
    }
    this.run(snapshot).catch(this.reportError);
  }

  /** The routing input now; while dragging a draft, see routingOptionsFor(). */
  private snapshot(): Snapshot {
    return takeSnapshot(this.cy, this.currentOptions, this.drag.active);
  }

  /** Routes a snapshot and applies the routes; rejects if routing fails. Changes in the meantime are routed afterwards. */
  private run(snapshot: Snapshot): Promise<void> {
    // also on failure: the same input is not retried on every following event
    this.last.modelKey = snapshot.key;
    this.last.draft = snapshot.draft;
    const start = performance.now();
    const run = this.backend.route(snapshot.model, this.routingOptionsFor(snapshot)).then(({ routes, routingMs }) => {
      if (this.state !== 'destroyed') this.applyRoutes(routes, snapshot, routingMs, start);
    });
    this.inFlight = run
      .catch(() => {}) // reported by the caller of run()
      .then(() => {
        this.inFlight = undefined;
        if (!this.rerun) return;
        this.rerun = false;
        this.scheduleRoute();
      });
    return run;
  }

  /** Styles the edges, keeps the routes and the timing of the run, and emits `avoidrouted`. */
  private applyRoutes(routes: Map<string, Point[]>, snapshot: Snapshot, routingMs: number, start: number): void {
    const { cornerRadius, labelPosition } = this.currentOptions;
    const stylingStart = performance.now();
    this.styler.apply(routes, { cornerRadius, labelPosition }, snapshot.nodePositions);
    this.currentRoutes = routes;
    const end = performance.now();
    this.last.end = end;
    // the time the run kept a thread busy; waiting (for libavoid, a worker or other code) does not count
    this.last.duration = routingMs + (end - stylingStart);
    const info: RoutedEventInfo = { edges: routes.size, routingMs, totalMs: end - start };
    this.cy.emit(ROUTED_EVENT, [info]);
  }

  /** While dragging, routes are drafts: without the slower detours around crowded gaps. */
  private routingOptionsFor(snapshot: Snapshot): LibavoidOptions {
    return snapshot.draft && this.currentOptions.detourCrowded
      ? { ...this.currentOptions, detourCrowded: false }
      : this.currentOptions;
  }

  /** For runs nobody awaits: an `avoiderror` event and the console. */
  private readonly reportError = (error: unknown): void => {
    if (this.state === 'destroyed') return;
    this.cy.emit(ERROR_EVENT, [error]);
    console.error(pluginMessage('re-route failed'), error);
  };

  /** How long to wait before the next re-route while dragging, see `dragRouteInterval`. */
  private dragPause(): number {
    const { dragRouteInterval } = this.currentOptions;
    if (dragRouteInterval === 'auto' && !this.backend.blocksThread) return 0; // e.g. a worker
    const interval = dragRouteInterval === 'auto' ? this.last.duration : dragRouteInterval;
    return this.last.end + interval - performance.now();
  }

  /** Listens to every change that can move a route, and to grab / release for the drag options. */
  private startListening(): void {
    if (this.listeners.length) return;
    this.drag.reset(this.cy);
    this.listen('grab', 'node', this.drag.onGrab);
    this.listen('free remove', 'node', this.drag.onRelease);
    const reroute = () => this.scheduleRoute();
    this.listen('add remove data', '*', reroute);
    this.listen('class style', 'node', reroute); // node size may depend on classes / styles
    this.listen('class', 'edge', reroute); // edge width may depend on classes
    // rerouteOnDrag is checked in runScheduledRoute()
    this.listen('position', 'node', (event) => {
      this.hideDraggedEdges(event.target as NodeSingular);
      reroute();
    });
    this.listen('free', 'node', reroute);
  }

  /**
   * With `hideEdgesOnDrag`: hides the edges of a dragged node until they are routed
   * again, and those of its children and of the compound nodes around it, which move along.
   */
  private hideDraggedEdges(node: NodeSingular): void {
    if (!this.currentOptions.hideEdgesOnDrag || !this.drag.active) return;
    this.styler.hide(node.union(node.descendants()).union(node.ancestors()).connectedEdges());
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

/** A worker resolves relative URLs against its own script, so they are made absolute first. */
function absoluteUrl(url: string | undefined): string | undefined {
  if (url === undefined || typeof document === 'undefined') return url;
  return new URL(url, document.baseURI).href;
}
