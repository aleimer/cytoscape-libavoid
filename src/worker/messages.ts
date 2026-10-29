// The messages between the plugin and routing.worker.ts, and the part of a Web
// Worker that sends and receives them.

import type { Point } from '../shared/geometry';
import type { GraphModel } from '../shared/graph';
import type { RoutingOptions } from '../routing/options';

/** Message from the plugin to routing.worker.ts. */
export interface RouteRequest {
  id: number;
  /** Absolute URL of libavoid.wasm; only the first request loads it. */
  wasmUrl?: string | undefined;
  model: GraphModel;
  options: RoutingOptions;
}

/** Answer of routing.worker.ts to a RouteRequest with the same id. */
export type RouteResponse =
  { id: number; routes: Array<[edgeId: string, points: Point[]]>; routingMs: number } | { id: number; error: string };

/**
 * The part of a Web Worker used here; a `Worker` running routing.worker.ts fits.
 * `error` / `messageerror` (the worker script failed to load or threw, or an answer
 * could not be read) reject the requests in flight.
 */
export interface RoutingWorker {
  postMessage(request: RouteRequest): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<RouteResponse>) => void): void;
  addEventListener(type: 'error' | 'messageerror', listener: (event: Event) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<RouteResponse>) => void): void;
  removeEventListener(type: 'error' | 'messageerror', listener: (event: Event) => void): void;
}
