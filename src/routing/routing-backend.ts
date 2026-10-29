// Where a graph is routed: in this thread (LocalRouter) or in a Web Worker
// (WorkerRouter). The plugin only knows this interface.

import type { Point } from '../shared/geometry';
import type { GraphModel } from '../shared/graph';
import type { RoutingOptions } from './options';

export interface RouteResult {
  /** Edge id -> route points, from the source end to the target end. */
  routes: Map<string, Point[]>;
  /** Time spent in libavoid. */
  routingMs: number;
}

export interface RoutingBackend {
  /** True if routing blocks this thread while it runs. */
  readonly blocksThread: boolean;
  /** Rejects if routing fails. */
  route(model: GraphModel, options: RoutingOptions): Promise<RouteResult>;
  /** Rejects the requests in flight and all later ones. */
  dispose(): void;
}
