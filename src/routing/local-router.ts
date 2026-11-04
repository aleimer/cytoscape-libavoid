/** Routing in this thread, behind the same interface as routing in a worker. */

import type { Avoid } from '../libavoid/api';
import { pluginError } from '../shared/errors';
import type { GraphModel } from '../shared/graph';
import { EdgeRouter } from './edge-router';
import type { RoutingOptions } from './options';
import type { RouteResult, RoutingBackend } from './routing-backend';

/** Routes with {@link EdgeRouter} in this thread, once libavoid is loaded. */
export class LocalRouter implements RoutingBackend
{
  /** Always true: {@link EdgeRouter.route} runs synchronously in this thread. */
  readonly blocksThread = true;
  /** libavoid, once loaded. */
  private readonly avoid: Promise<Avoid>;
  /** Set by {@link LocalRouter.dispose}; later requests reject. */
  private disposed = false;

  /** @param avoid libavoid, or the promise of it, see `loadLibavoid()` */
  constructor(avoid: Avoid | Promise<Avoid>)
  {
    this.avoid = Promise.resolve(avoid);
  }

  /**
   * Routes with {@link EdgeRouter} once libavoid is loaded.
   *
   * @param model   the graph to route
   * @param options the routing options; other fields are ignored
   * @returns the routes and how long routing took; rejects if routing fails or
   *   after {@link LocalRouter.dispose}
   */
  async route(model: GraphModel, options: RoutingOptions): Promise<RouteResult>
  {
    const avoid = await this.avoid;
    if (this.disposed)
    {
      throw pluginError('router disposed');
    }
    const start = performance.now();
    const routes = new EdgeRouter(avoid, options).route(model);
    return { routes, routingMs: performance.now() - start };
  }

  /**
   * Later requests reject, and so do those still waiting for libavoid to load.
   * A run that has started cannot be stopped: it is synchronous.
   */
  dispose(): void
  {
    this.disposed = true;
  }
}
