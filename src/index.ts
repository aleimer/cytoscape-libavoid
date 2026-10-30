// Public API: registers `cy.libavoid()` and exports what an app needs. Other
// building blocks are imported from their files.
//
//   cytoscape-adapter/   the only folder that knows Cytoscape: LibavoidRouting,
//                        options, edge styles, scheduling
//   worker/              routing in a Web Worker (entry: routing.worker.ts)
//   routing/             EdgeRouter: graph model -> routes; LocalRouter and the
//                        RoutingBackend interface it shares with WorkerRouter
//   postprocess/         separating overlapping edges, detours, route quality
//   libavoid/            loading libavoid-js and wrapping its API
//   shared/              geometry, the plain graph model, messages and option
//                        checks; used by all folders, imports nothing else
//
// Each folder only imports from the ones below it (npm run deps:check).

import type cytoscapeFactory from 'cytoscape';
import type { Core } from 'cytoscape';
import { LibavoidRouting, SCRATCH_KEY } from './cytoscape-adapter/libavoid-routing';
import type { LibavoidOptions } from './cytoscape-adapter/options';

// the plugin
export { LibavoidRouting } from './cytoscape-adapter/libavoid-routing';
export { defaults } from './cytoscape-adapter/options';
export type { EdgeSides, LibavoidOptions, RoutedEventInfo } from './cytoscape-adapter/options';
// routing without Cytoscape
export { loadLibavoid } from './libavoid/load';
export type { Avoid, RoutingOptionName, RoutingParameterName } from './libavoid/api';
export { EdgeRouter } from './routing/edge-router';
export { defaultRoutingOptions } from './routing/options';
export type { RoutingOptions } from './routing/options';
export type { RouteResult, RoutingBackend } from './routing/routing-backend';
export { routeQuality } from './postprocess/route-quality';
export type { RouteQuality } from './postprocess/route-quality';
export type { Point, Side } from './shared/geometry';
export type { GraphEdge, GraphModel, GraphNode } from './shared/graph';
// routing in a Web Worker
export { WorkerRouter } from './worker/worker-router';
export type { RoutingWorker } from './worker/messages';

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
