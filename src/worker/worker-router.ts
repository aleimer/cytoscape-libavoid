// The plugin's side of routing in a Web Worker.

import { pluginError } from '../shared/errors';
import type { GraphModel } from '../shared/graph';
import type { RouteResult, RoutingBackend } from '../routing/routing-backend';
import { pickRoutingOptions } from '../routing/options';
import type { RoutingOptions } from '../routing/options';
import type { RouteResponse, RoutingWorker } from './messages';

/** Request ids are unique across all WorkerRouters, so several of them can share one worker. */
let lastRequestId = 0;

/**
 * Sends routing requests to a worker running routing.worker.ts: the
 * asynchronous counterpart of EdgeRouter. Answers are matched by request id.
 */
export class WorkerRouter implements RoutingBackend {
  readonly blocksThread = false;
  private readonly worker: RoutingWorker;
  private readonly wasmUrl: string | undefined;
  private readonly pending = new Map<number, PromiseWithCallbacks<RouteResult>>();
  private disposed = false;

  /** @param wasmUrl absolute URL of libavoid.wasm (the worker resolves relative ones against its script) */
  constructor(worker: RoutingWorker, wasmUrl?: string | undefined) {
    this.worker = worker;
    this.wasmUrl = wasmUrl;
    worker.addEventListener('message', this.onMessage);
    worker.addEventListener('error', this.onError);
    worker.addEventListener('messageerror', this.onError);
  }

  /** True while a request is unanswered. */
  get busy(): boolean {
    return this.pending.size > 0;
  }

  /** Rejects with the worker's error message if routing fails there. */
  route(model: GraphModel, options: RoutingOptions): Promise<RouteResult> {
    if (this.disposed) return Promise.reject(pluginError('worker router disposed'));
    const id = ++lastRequestId;
    const answer = promiseWithCallbacks<RouteResult>();
    this.pending.set(id, answer);
    // only the routing options: functions such as the plugin's edgeWidth cannot be posted
    this.worker.postMessage({ id, wasmUrl: this.wasmUrl, model, options: pickRoutingOptions(options) });
    return answer.promise;
  }

  /** Stops listening; unanswered requests are rejected. The worker itself keeps running. */
  dispose(): void {
    this.disposed = true;
    this.worker.removeEventListener('message', this.onMessage);
    this.worker.removeEventListener('error', this.onError);
    this.worker.removeEventListener('messageerror', this.onError);
    this.rejectAll(pluginError('worker router disposed'));
  }

  private rejectAll(error: Error): void {
    for (const answer of this.pending.values()) answer.reject(error);
    this.pending.clear();
  }

  /**
   * Without this a worker that failed to load would leave every request, and with
   * it the plugin, waiting forever. The event does not say which request failed.
   */
  private readonly onError = (event: Event): void => {
    const detail = 'message' in event && typeof event.message === 'string' && event.message ? `: ${event.message}` : '';
    this.rejectAll(pluginError(`the routing worker failed (${event.type})${detail}`));
  };

  private readonly onMessage = (event: MessageEvent<RouteResponse>): void => {
    const response = event.data;
    const answer = this.pending.get(response.id);
    if (!answer) return; // a request of another WorkerRouter
    this.pending.delete(response.id);
    if ('error' in response) {
      answer.reject(pluginError(response.error));
    } else {
      answer.resolve({ routes: new Map(response.routes), routingMs: response.routingMs });
    }
  };
}

interface PromiseWithCallbacks<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

// like Promise.withResolvers(), which needs ES2024
function promiseWithCallbacks<T>(): PromiseWithCallbacks<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
