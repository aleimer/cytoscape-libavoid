/** The plugin's side of routing in a Web Worker. */

import { pickRoutingOptions } from '../routing/options';
import type { RoutingOptions } from '../routing/options';
import type { RouteResult, RoutingBackend } from '../routing/routing-backend';
import { pluginError } from '../shared/errors';
import type { GraphModel } from '../shared/graph';
import type { RouteResponse, RoutingWorker } from './messages';

/** Request ids are unique across all WorkerRouters, so several of them can share one worker. */
let lastRequestId = 0;

/**
 * Sends routing requests to a worker running routing.worker.ts: the
 * asynchronous counterpart of `EdgeRouter`. Answers are matched by request id.
 */
export class WorkerRouter implements RoutingBackend
{
  /** Always false: the worker routes in its own thread. */
  readonly blocksThread = false;
  /** The worker the requests go to; it may be shared with other WorkerRouters. */
  private readonly worker: RoutingWorker;
  /** Sent with every request; only the worker's first request loads it. */
  private readonly wasmUrl: string | undefined;
  /** The unanswered requests by id. */
  private readonly pending = new Map<number, PromiseWithCallbacks<RouteResult>>();
  /** Set by {@link WorkerRouter.dispose}; later requests reject. */
  private disposed = false;

  /**
   * Starts listening to the worker's answers and errors.
   *
   * @param worker  a worker running routing.worker.ts
   * @param wasmUrl absolute URL of libavoid.wasm (the worker resolves relative ones against its script)
   */
  constructor(worker: RoutingWorker, wasmUrl?: string | undefined)
  {
    this.worker = worker;
    this.wasmUrl = wasmUrl;
    worker.addEventListener('message', this.onMessage);
    worker.addEventListener('error', this.onError);
    worker.addEventListener('messageerror', this.onError);
  }

  /** True while a request is unanswered. */
  get busy(): boolean
  {
    return this.pending.size > 0;
  }

  /**
   * Sends a graph model to the worker.
   *
   * @param model   the graph to route
   * @param options only the routing options are posted, see {@link pickRoutingOptions}
   * @returns the worker's routes; rejects with the worker's error message if routing
   *   fails there, or if this router is disposed
   */
  route(model: GraphModel, options: RoutingOptions): Promise<RouteResult>
  {
    if (this.disposed)
    {
      return Promise.reject(pluginError('worker router disposed'));
    }
    const id = ++lastRequestId;
    const answer = promiseWithCallbacks<RouteResult>();
    this.pending.set(id, answer);
    // only the routing options: functions such as the plugin's edgeWidth cannot be posted
    this.worker.postMessage({ id, wasmUrl: this.wasmUrl, model, options: pickRoutingOptions(options) });
    return answer.promise;
  }

  /** Stops listening; unanswered requests are rejected. The worker itself keeps running. */
  dispose(): void
  {
    this.disposed = true;
    this.worker.removeEventListener('message', this.onMessage);
    this.worker.removeEventListener('error', this.onError);
    this.worker.removeEventListener('messageerror', this.onError);
    this.rejectAll(pluginError('worker router disposed'));
  }

  /**
   * Rejects every unanswered request and forgets them.
   *
   * @param error the reason they all get
   */
  private rejectAll(error: Error): void
  {
    for (const answer of this.pending.values())
    {
      answer.reject(error);
    }
    this.pending.clear();
  }

  /**
   * For `error` / `messageerror`: rejects every request in flight, as the event does
   * not say which one failed. Without this a worker that failed to load would leave
   * the requests, and with them the plugin, waiting forever.
   *
   * @param event the worker's error event; its message, if any, goes into the rejection
   */
  private readonly onError = (event: Event): void =>
  {
    const detail = 'message' in event && typeof event.message === 'string' && event.message ? `: ${event.message}` : '';
    this.rejectAll(pluginError(`the routing worker failed (${event.type})${detail}`));
  };

  /**
   * For `message`: settles the request the answer belongs to; answers to other
   * WorkerRouters sharing the worker are ignored.
   *
   * @param event the worker's answer
   */
  private readonly onMessage = (event: MessageEvent<RouteResponse>): void =>
  {
    const response = event.data;
    const answer = this.pending.get(response.id);
    if (!answer)
    {
      return; // a request of another WorkerRouter
    }
    this.pending.delete(response.id);
    if ('error' in response)
    {
      answer.reject(pluginError(response.error));
    }
    else
    {
      answer.resolve({ routes: new Map(response.routes), routingMs: response.routingMs });
    }
  };
}

/** A promise together with the callbacks that settle it, see {@link promiseWithCallbacks}. */
interface PromiseWithCallbacks<T>
{
  /** Settles once one of the callbacks is called. */
  promise: Promise<T>;
  /** @param value fulfils {@link PromiseWithCallbacks.promise} with it */
  resolve(value: T): void;
  /** @param error rejects {@link PromiseWithCallbacks.promise} with it */
  reject(error: unknown): void;
}

/**
 * A new promise with its callbacks; like `Promise.withResolvers()`, which needs ES2024.
 *
 * @returns the pending promise and the callbacks that settle it
 */
function promiseWithCallbacks<T>(): PromiseWithCallbacks<T>
{
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) =>
  {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
