/**
 * The messages between the plugin and routing.worker.ts, and the part of a Web
 * Worker that sends and receives them.
 */

import type { RoutingOptions } from "../routing/options";
import type { Point } from "../shared/geometry";
import type { GraphModel } from "../shared/graph";

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

/** The answer of routing.worker.ts when routing succeeded. */
export interface RoutedResponse
{
    /** The {@link RouteRequest.id} this answers. */
    id: number;
    /** Edge id / route points pairs, from the source end to the target end; a Map cannot be posted. */
    routes: Array<[edgeId: string, points: Point[]]>;
    /** How long routing took in the worker (ms): libavoid plus the post-processing. */
    routingMs: number;
}

/** The answer of routing.worker.ts when routing failed. */
export interface FailedResponse
{
    /** The {@link RouteRequest.id} this answers. */
    id: number;
    /** The message of the error routing threw in the worker. */
    error: string;
}

/** Answer of routing.worker.ts to a {@link RouteRequest} with the same id; `error` tells the two apart. */
export type RouteResponse = RoutedResponse | FailedResponse;

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
    addEventListener(type: "message", listener: (event: MessageEvent<RouteResponse>) => void): void;
    /**
     * @param type     `error` / `messageerror`: the worker failed or an answer could not be read
     * @param listener called with the event
     */
    addEventListener(type: "error" | "messageerror", listener: (event: Event) => void): void;
    /**
     * @param type     `message`
     * @param listener the listener added before
     */
    removeEventListener(type: "message", listener: (event: MessageEvent<RouteResponse>) => void): void;
    /**
     * @param type     `error` / `messageerror`
     * @param listener the listener added before
     */
    removeEventListener(type: "error" | "messageerror", listener: (event: Event) => void): void;
}
