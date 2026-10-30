// Routing in this thread, behind the same interface as routing in a worker.

import type { Avoid } from '../libavoid/api';
import { pluginError } from '../shared/errors';
import type { GraphModel } from '../shared/graph';
import { EdgeRouter } from './edge-router';
import type { RoutingOptions } from './options';
import type { RouteResult, RoutingBackend } from './routing-backend';

/** Routes with EdgeRouter in this thread, once libavoid is loaded. */
export class LocalRouter implements RoutingBackend
{
  readonly blocksThread = true;
  private readonly avoid: Promise<Avoid>;
  private disposed = false;

  /** @param avoid libavoid, or the promise of it, see loadLibavoid() */
  constructor(avoid: Avoid | Promise<Avoid>)
  {
    this.avoid = Promise.resolve(avoid);
  }

  /** Routes with EdgeRouter once libavoid is loaded; rejects if routing fails or after dispose(). */
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
