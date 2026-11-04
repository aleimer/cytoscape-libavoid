/**
 * The messages between the plugin and routing.worker.ts, and the part of a Web
 * Worker that sends and receives them.
 */

import type { RoutingOptions } from '../routing/options';
import type { Point } from '../shared/geometry';
import type { GraphModel } from '../shared/graph';

/** Message from the plugin to routing.worker.ts. */
export interface RouteRequest
{
  /** Unique across all senders; the answer carries the same id. */
  id: number;
  /** Absolute URL of libavoid.wasm; only the first request loads it. */
  wasmUrl?: string | undefined;
  /** The graph to route. */
  model: GraphModel;
  /** Only the routing options: functions cannot be posted. */
  options: RoutingOptions;
}

/**
 * Answer of routing.worker.ts to a {@link RouteRequest} with the same id: the routes
 * as edge id / points pairs (a Map cannot be posted) and how long routing took,
 * or the error message if routing failed.
 */
export type RouteResponse = { id: number; routes: Array<[edgeId: string, points: Point[]]>; routingMs: number; } | {
  id: number;
  error: string;
};

/**
 * The part of a Web Worker used here; a `Worker` running routing.worker.ts fits.
 * `error` / `messageerror` (the worker script failed to load or threw, or an answer
 * could not be read) reject the requests in flight.
 */
export interface RoutingWorker
{
  /** @param request sent to the worker */
  postMessage(request: RouteRequest): void;
  /**
   * @param type     `message`: an answer arrived
   * @param listener called with the {@link RouteResponse}
   */
  addEventListener(type: 'message', listener: (event: MessageEvent<RouteResponse>) => void): void;
  /**
   * @param type     `error` / `messageerror`: the worker failed or an answer could not be read
   * @param listener called with the event
   */
  addEventListener(type: 'error' | 'messageerror', listener: (event: Event) => void): void;
  /**
   * @param type     `message`
   * @param listener the listener added before
   */
  removeEventListener(type: 'message', listener: (event: MessageEvent<RouteResponse>) => void): void;
  /**
   * @param type     `error` / `messageerror`
   * @param listener the listener added before
   */
  removeEventListener(type: 'error' | 'messageerror', listener: (event: Event) => void): void;
}
