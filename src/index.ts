import { AvoidLib } from 'libavoid-js';
import type cytoscapeFactory from 'cytoscape';
import type { Core, EdgeSingular, EventHandler, EventObject, NodeSingular } from 'cytoscape';
import { routeGraph, defaultRoutingOptions, SIDES } from './routing.ts';
import type { GraphModel, RoutingOptions, Side } from './routing.ts';
import { routeToEdgeStyle, STYLE_PROPS } from './edge-style.ts';
import type { Avoid, Point } from './libavoid.ts';

export { routeGraph, computeSankeyPorts, simplify } from './routing.ts';
export type { FlowDirection, GraphEdge, GraphModel, GraphNode, RoutingOptions, SankeyPort, SankeyPorts, Side } from './routing.ts';
export { routeToEdgeStyle, edgeStyleToPoints } from './edge-style.ts';
export type { EdgeSegmentStyle } from './edge-style.ts';
export type { Avoid, Point, RoutingOptionName, RoutingParameterName } from './libavoid.ts';

const SCRATCH_KEY = '_libavoid';
const ROUTED_EVENT = 'avoidrouted';

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

export const defaults: LibavoidOptions = {
  ...defaultRoutingOptions,
  wasmUrl: undefined, // URL of libavoid.wasm; required in the browser unless the file sits next to the bundle
  avoidLib: undefined, // an already loaded libavoid instance (AvoidLib.getInstance()); skips loading
  edges: 'edge', // selector for edges to route
  obstacles: 'node:childless', // selector for nodes acting as obstacles / endpoints
  includeLabels: false, // let node labels count as part of the obstacle
  edgeWidth: (edge) => Number(edge.numericStyle('width')), // used for sankey stacking and auto nudging
  cornerRadius: 0, // 0 = sharp taxi corners, > 0 = rounded corners ('round-segments')
  live: true, // re-route automatically on add / remove / move / data changes
  rerouteOnDrag: true, // when live: re-route continuously while dragging (false = only on release)
};

let loading: Promise<Avoid> | null = null;

// In a classic <script> (UMD build) libavoid cannot find its .wasm on its own
// because it loads asynchronously, after document.currentScript is gone.
const currentScript = typeof document !== 'undefined' ? document.currentScript : null;
const scriptSrc = currentScript && 'src' in currentScript ? currentScript.src : undefined;

/** Loads the libavoid WebAssembly module once and caches the instance. */
export function loadLibavoid(wasmUrl?: string): Promise<Avoid> {
  if (!loading) {
    if (wasmUrl === undefined && scriptSrc) wasmUrl = new URL('libavoid.wasm', scriptSrc).href;
    loading = AvoidLib.load(wasmUrl)
      .then(() => AvoidLib.getInstance())
      .catch((err: Error) => {
        loading = null;
        throw err;
      });
  }
  return loading;
}

const schedule: (fn: () => void) => void =
  typeof requestAnimationFrame === 'function' ? (fn) => requestAnimationFrame(fn) : (fn) => setTimeout(fn, 0);

export class LibavoidRouting {
  readonly cy: Core;
  readonly options: LibavoidOptions;
  readonly ready: Promise<LibavoidRouting>;
  Avoid: Avoid | null = null;
  routes = new Map<string, Point[]>();
  styled = new Set<string>();
  destroyed = false;
  private _pending = false;
  private _listeners: Array<[string, string, EventHandler]> = [];

  constructor(cy: Core, options: Partial<LibavoidOptions> = {}) {
    this.cy = cy;
    this.options = { ...defaults, ...options };

    const instance = this.options.avoidLib ? Promise.resolve(this.options.avoidLib) : loadLibavoid(this.options.wasmUrl);
    this.ready = instance.then((Avoid) => {
      if (this.destroyed) return this;
      this.Avoid = Avoid;
      if (this.options.live) this._bind();
      this.route();
      return this;
    });
  }

  /** Builds the plain graph model handed to the routing core. */
  model(): GraphModel {
    const { cy, options } = this;
    const nodes = cy.nodes(options.obstacles).filter((n) => n.visible());
    const nodeIds = new Set(nodes.map((n) => n.id()));
    const edges = cy
      .edges(options.edges)
      .toArray()
      .filter((e) => e.visible() && nodeIds.has(e.source().id()) && nodeIds.has(e.target().id()));

    return {
      nodes: nodes.map((n) => {
        const bb = n.boundingBox({ includeLabels: options.includeLabels, includeOverlays: false });
        return { id: n.id(), x: (bb.x1 + bb.x2) / 2, y: (bb.y1 + bb.y2) / 2, w: bb.w, h: bb.h };
      }),
      edges: edges.map((e) => ({
        id: e.id(),
        source: e.source().id(),
        target: e.target().id(),
        width: Number(options.edgeWidth(e)) || 0,
        sourceSide: side(e.data('sourceSide')),
        targetSide: side(e.data('targetSide')),
      })),
    };
  }

  /** Routes all edges now. Returns a Map edge id -> route points. */
  route(): Map<string, Point[]> {
    if (this.destroyed) return this.routes;
    if (!this.Avoid) throw new Error('cytoscape-libavoid: not ready yet, await routing.ready first');
    const { cy, options } = this;
    const t0 = now();
    const routes = routeGraph(this.Avoid, this.model(), options);
    const t1 = now();

    cy.batch(() => {
      for (const id of this.styled) {
        if (!routes.has(id)) {
          const edge = cy.getElementById(id);
          if (edge.nonempty()) edge.removeStyle(STYLE_PROPS.join(' '));
          this.styled.delete(id);
        }
      }
      for (const [id, points] of routes) {
        const edge = cy.getElementById(id);
        const style = routeToEdgeStyle(points, edge.source().position(), edge.target().position(), options.cornerRadius);
        if (!style) continue;
        if (!(options.cornerRadius > 0)) edge.removeStyle('segment-radii radius-type');
        edge.style(style);
        this.styled.add(id);
      }
    });

    this.routes = routes;
    const info: RoutedEventInfo = { edges: routes.size, routingMs: t1 - t0, totalMs: now() - t0 };
    cy.emit(ROUTED_EVENT, [info]);
    return routes;
  }

  /** Coalesces many change events into one re-route per animation frame. */
  scheduleRoute(): void {
    if (this._pending || this.destroyed || !this.Avoid) return;
    this._pending = true;
    schedule(() => {
      this._pending = false;
      if (!this.destroyed) this.route();
    });
  }

  /** Route points of an edge (edge element or id), or undefined if not routed. */
  getRoute(edge: EdgeSingular | string): Point[] | undefined {
    const id = typeof edge === 'string' ? edge : edge.id();
    return this.routes.get(id);
  }

  /** Changes options and re-routes. */
  setOptions(options: Partial<LibavoidOptions>): this {
    const wasLive = this.options.live;
    Object.assign(this.options, options);
    if (this.Avoid && wasLive !== this.options.live) this.options.live ? this._bind() : this._unbind();
    if (this.Avoid) this.route();
    return this;
  }

  /** Stops routing and restores the edges' own styles. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this._unbind();
    const { cy } = this;
    cy.batch(() => {
      for (const id of this.styled) {
        const edge = cy.getElementById(id);
        if (edge.nonempty()) edge.removeStyle(STYLE_PROPS.join(' '));
      }
    });
    this.styled.clear();
    this.routes.clear();
    if (cy.scratch(SCRATCH_KEY) === this) cy.removeScratch(SCRATCH_KEY);
  }

  private _on(events: string, selector: string, handler: EventHandler): void {
    this.cy.on(events, selector, handler);
    this._listeners.push([events, selector, handler]);
  }

  private _bind(): void {
    if (this._listeners.length) return;
    const reroute = () => this.scheduleRoute();
    this._on('add remove data', '*', reroute);
    this._on('class style', 'node', reroute); // node size may depend on classes / styles
    this._on('class', 'edge', reroute); // edge width may depend on classes
    this._on('position', 'node', (evt: EventObject) => {
      const node: NodeSingular = evt.target;
      if (this.options.rerouteOnDrag || !node.grabbed()) reroute();
    });
    this._on('free', 'node', reroute);
  }

  private _unbind(): void {
    for (const [events, selector, handler] of this._listeners) this.cy.off(events, selector, handler);
    this._listeners = [];
  }
}

const side = (v: string | undefined): Side | undefined => SIDES.find((s) => s === v);
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

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
export default function register(cytoscape: typeof cytoscapeFactory | undefined): void {
  if (!cytoscape) return;
  cytoscape('core', 'libavoid', function (this: Core, options?: Partial<LibavoidOptions>): LibavoidRouting {
    const stored = this.scratch(SCRATCH_KEY);
    const current = stored instanceof LibavoidRouting ? stored : undefined;
    if (current && !options) return current;
    if (current) current.destroy();
    const routing = new LibavoidRouting(this, options);
    this.scratch(SCRATCH_KEY, routing);
    return routing;
  });
}
