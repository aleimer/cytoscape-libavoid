// Routing in this thread, behind the same interface as a worker.

import { pluginError } from '../shared/errors';
import type { GraphModel } from '../shared/graph';
import type { Avoid } from '../libavoid/api';
import type { RouteResult, RoutingBackend } from './routing-backend';
import { EdgeRouter } from './edge-router';
import type { RoutingOptions } from './options';

/** Routes with EdgeRouter in this thread, once libavoid is loaded. */
export class LocalRouter implements RoutingBackend {
  readonly blocksThread = true;
  private readonly avoid: Promise<Avoid>;
  private disposed = false;

  /** @param avoid libavoid, or the promise of it, see loadLibavoid() */
  constructor(avoid: Avoid | Promise<Avoid>) {
    this.avoid = Promise.resolve(avoid);
  }

  async route(model: GraphModel, options: RoutingOptions): Promise<RouteResult> {
    const avoid = await this.avoid;
    if (this.disposed) throw pluginError('router disposed');
    const start = performance.now();
    const routes = new EdgeRouter(avoid, options).route(model);
    return { routes, routingMs: performance.now() - start };
  }

  /** A run is synchronous once libavoid is loaded, so only one waiting for it is affected. */
  dispose(): void {
    this.disposed = true;
  }
}
