// The worker's side: answers the requests the plugin sends to routing.worker.ts.
// A function of its own, so tests can answer requests without a real worker.

import { loadLibavoid } from '../libavoid/load';
import { LocalRouter } from '../routing/local-router';
import type { RouteRequest, RouteResponse } from './messages';

/** Routes one request, loading libavoid on first use. Runs inside routing.worker.ts. */
export async function answerRouteRequest(request: RouteRequest): Promise<RouteResponse> {
  try {
    const router = new LocalRouter(loadLibavoid(request.wasmUrl));
    const { routes, routingMs } = await router.route(request.model, request.options);
    return { id: request.id, routes: [...routes], routingMs };
  } catch (error) {
    return { id: request.id, error: error instanceof Error ? error.message : String(error) };
  }
}
