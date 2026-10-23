import { AvoidLib } from 'libavoid-js';
import { routeGraph, defaultRoutingOptions, SIDES } from './routing.js';
import { routeToEdgeStyle, STYLE_PROPS } from './edge-style.js';
export { routeGraph, computeSankeyPorts, simplify } from './routing.js';
export { routeToEdgeStyle, edgeStyleToPoints } from './edge-style.js';
const SCRATCH_KEY = '_libavoid';
const ROUTED_EVENT = 'avoidrouted';
export const defaults = {
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
let loading = null;
// In a classic <script> (UMD build) libavoid cannot find its .wasm on its own
// because it loads asynchronously, after document.currentScript is gone.
const currentScript = typeof document !== 'undefined' ? document.currentScript : null;
const scriptSrc = currentScript && 'src' in currentScript ? currentScript.src : undefined;
/** Loads the libavoid WebAssembly module once and caches the instance. */
export function loadLibavoid(wasmUrl) {
    if (!loading) {
        if (wasmUrl === undefined && scriptSrc)
            wasmUrl = new URL('libavoid.wasm', scriptSrc).href;
        loading = AvoidLib.load(wasmUrl)
            .then(() => AvoidLib.getInstance())
            .catch((err) => {
            loading = null;
            throw err;
        });
    }
    return loading;
}
const schedule = typeof requestAnimationFrame === 'function' ? (fn) => requestAnimationFrame(fn) : (fn) => setTimeout(fn, 0);
export class LibavoidRouting {
    cy;
    options;
    ready;
    Avoid = null;
    routes = new Map();
    styled = new Set();
    destroyed = false;
    _pending = false;
    _modelKey = '';
    // edge id -> element + style last applied to it, to skip unchanged edges
    _applied = new Map();
    _listeners = [];
    constructor(cy, options = {}) {
        this.cy = cy;
        this.options = { ...defaults, ...options };
        const instance = this.options.avoidLib ? Promise.resolve(this.options.avoidLib) : loadLibavoid(this.options.wasmUrl);
        this.ready = instance.then((Avoid) => {
            if (this.destroyed)
                return this;
            this.Avoid = Avoid;
            if (this.options.live)
                this._bind();
            this.route();
            return this;
        });
    }
    /** Builds the plain graph model handed to the routing core. */
    model() {
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
    route() {
        if (this.destroyed)
            return this.routes;
        if (!this.Avoid)
            throw new Error('cytoscape-libavoid: not ready yet, await routing.ready first');
        return this._route(this.model());
    }
    _route(model) {
        const { cy, options } = this;
        const t0 = now();
        const routes = routeGraph(this.Avoid, model, options);
        this._modelKey = JSON.stringify(model);
        const t1 = now();
        cy.batch(() => {
            for (const id of this.styled) {
                if (!routes.has(id)) {
                    const edge = cy.getElementById(id);
                    if (edge.nonempty())
                        edge.removeStyle(STYLE_PROPS.join(' '));
                    this.styled.delete(id);
                    this._applied.delete(id);
                }
            }
            for (const [id, points] of routes) {
                const edge = cy.getElementById(id);
                const style = routeToEdgeStyle(points, edge.source().position(), edge.target().position(), options.cornerRadius);
                if (!style)
                    continue;
                // every style update is costly and, with compound nodes, fires 'style' on all nodes
                const key = JSON.stringify(style);
                const prev = this._applied.get(id);
                if (prev && prev.ele === edge[0] && prev.key === key)
                    continue;
                if (!(options.cornerRadius > 0))
                    edge.removeStyle('segment-radii radius-type');
                edge.style(style);
                this.styled.add(id);
                this._applied.set(id, { ele: edge[0], key });
            }
        });
        this.routes = routes;
        const info = { edges: routes.size, routingMs: t1 - t0, totalMs: now() - t0 };
        cy.emit(ROUTED_EVENT, [info]);
        return routes;
    }
    /**
     * Coalesces many change events into one re-route per animation frame, and
     * skips it when the routing input did not change: style / data events also
     * fire for changes that do not move anything, e.g. live data, or (with
     * compound nodes) for every node whenever edge styles are set by route().
     */
    scheduleRoute() {
        if (this._pending || this.destroyed || !this.Avoid)
            return;
        this._pending = true;
        schedule(() => {
            this._pending = false;
            if (this.destroyed)
                return;
            const model = this.model();
            if (JSON.stringify(model) !== this._modelKey)
                this._route(model);
        });
    }
    /** Route points of an edge (edge element or id), or undefined if not routed. */
    getRoute(edge) {
        const id = typeof edge === 'string' ? edge : edge.id();
        return this.routes.get(id);
    }
    /** Changes options and re-routes. */
    setOptions(options) {
        const wasLive = this.options.live;
        Object.assign(this.options, options);
        if (this.Avoid && wasLive !== this.options.live)
            this.options.live ? this._bind() : this._unbind();
        if (this.Avoid)
            this.route();
        return this;
    }
    /** Stops routing and restores the edges' own styles. */
    destroy() {
        if (this.destroyed)
            return;
        this.destroyed = true;
        this._unbind();
        const { cy } = this;
        cy.batch(() => {
            for (const id of this.styled) {
                const edge = cy.getElementById(id);
                if (edge.nonempty())
                    edge.removeStyle(STYLE_PROPS.join(' '));
            }
        });
        this.styled.clear();
        this._applied.clear();
        this.routes.clear();
        if (cy.scratch(SCRATCH_KEY) === this)
            cy.removeScratch(SCRATCH_KEY);
    }
    _on(events, selector, handler) {
        this.cy.on(events, selector, handler);
        this._listeners.push([events, selector, handler]);
    }
    _bind() {
        if (this._listeners.length)
            return;
        const reroute = () => this.scheduleRoute();
        this._on('add remove data', '*', reroute);
        this._on('class style', 'node', reroute); // node size may depend on classes / styles
        this._on('class', 'edge', reroute); // edge width may depend on classes
        this._on('position', 'node', (evt) => {
            const node = evt.target;
            if (this.options.rerouteOnDrag || !node.grabbed())
                reroute();
        });
        this._on('free', 'node', reroute);
    }
    _unbind() {
        for (const [events, selector, handler] of this._listeners)
            this.cy.off(events, selector, handler);
        this._listeners = [];
    }
}
const side = (v) => SIDES.find((s) => s === v);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
/**
 * Cytoscape extension entry point: `cytoscape.use(cytoscapeLibavoid)`.
 * Adds `cy.libavoid(options)` which returns a LibavoidRouting instance.
 * Calling it again with options replaces the previous instance; without
 * options it returns the current one (creating it with defaults if needed).
 */
export default function register(cytoscape) {
    if (!cytoscape)
        return;
    cytoscape('core', 'libavoid', function (options) {
        const stored = this.scratch(SCRATCH_KEY);
        const current = stored instanceof LibavoidRouting ? stored : undefined;
        if (current && !options)
            return current;
        if (current)
            current.destroy();
        const routing = new LibavoidRouting(this, options);
        this.scratch(SCRATCH_KEY, routing);
        return routing;
    });
}
//# sourceMappingURL=index.js.map