// Where a graph is routed: in this thread (LocalRouter) or in a Web Worker
// (WorkerRouter). LibavoidRouting only knows this interface, so it has a single
// code path for both.

import type { Point } from '../shared/geometry';
import type { GraphModel } from '../shared/graph';
import type { RoutingOptions } from './options';

/** The routes of one run. */
export interface RouteResult {
  /** Edge id -> route points, from the source end to the target end. */
  routes: Map<string, Point[]>;
  /**
   * How long EdgeRouter took (ms): libavoid plus the post-processing. Without
   * waiting for libavoid to load or for a worker's messages.
   */
  routingMs: number;
}

/** Routes graph models, one request after another, in this thread or elsewhere. */
export interface RoutingBackend {
  /**
   * True if routing blocks this thread while it runs. `dragRouteInterval: 'auto'`
   * only pauses between runs while dragging if it does.
   */
  readonly blocksThread: boolean;
  /**
   * Rejects if routing fails. `options` may be a larger object, e.g. the plugin's
   * options; only the routing options are used.
   */
  route(model: GraphModel, options: RoutingOptions): Promise<RouteResult>;
  /** Rejects the requests in flight and all later ones. */
  dispose(): void;
}
