// Shared test helpers (not a test file itself: not matched by *.test.ts).
import cytoscape from 'cytoscape';
import type { Core, ElementDefinition, NodeSingular } from 'cytoscape';
import type { GraphNode, Point, RoutingWorker } from '../src';
import { answerRouteRequest } from '../src/worker/answer-route-request';
import type { RouteRequest, RouteResponse } from '../src/worker/messages';

export interface Rect {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

export const box = (node: GraphNode, padding = 0): Rect => ({
  x1: node.x - node.width / 2 - padding,
  x2: node.x + node.width / 2 + padding,
  y1: node.y - node.height / 2 - padding,
  y2: node.y + node.height / 2 + padding,
});

/** Does the axis-aligned segment a-b cross the open interior of r? */
export function segmentHitsRect(a: Point, b: Point, r: Rect): boolean {
  const x1 = Math.min(a.x, b.x);
  const x2 = Math.max(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const y2 = Math.max(a.y, b.y);
  return x1 < r.x2 && x2 > r.x1 && y1 < r.y2 && y2 > r.y1;
}

/** A headless Cytoscape graph with 40 x 40 px nodes and 3 px taxi edges. */
export function createCy(elements: ElementDefinition[]): Core {
  return cytoscape({
    headless: true,
    styleEnabled: true,
    layout: { name: 'preset' }, // the default 'null' layout would move every node to (0, 0)
    elements,
    style: [
      { selector: 'node', style: { width: 40, height: 40, shape: 'rectangle' } },
      { selector: 'edge', style: { width: 3, 'curve-style': 'taxi' } },
    ],
  });
}

/** Two nodes a and b with an obstacle c between them, edge ab. */
export const obstacleElements = (): ElementDefinition[] => [
  { data: { id: 'a' }, position: { x: 0, y: 0 } },
  { data: { id: 'b' }, position: { x: 300, y: 0 } },
  { data: { id: 'c' }, position: { x: 150, y: 0 } },
  { data: { id: 'ab', source: 'a', target: 'b' } },
];

/**
 * Headless Cytoscape has no mouse, so grabbing is simulated through the private
 * flag and the `grab` event the renderer fires. Releasing fires no `free`, the
 * tests emit it themselves where the release matters.
 */
export function setGrabbed(node: NodeSingular, grabbed: boolean): void {
  (node as unknown as { _private: { grabbed: boolean } })._private.grabbed = grabbed;
  if (grabbed) node.emit('grab');
}

export const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Counts the `avoidrouted` events of a graph. */
export function countRoutes(cy: Core): { readonly count: number; reset(): void } {
  let count = 0;
  cy.on('avoidrouted', () => count++);
  return {
    get count() {
      return count;
    },
    reset() {
      count = 0;
    },
  };
}

type WorkerListener = (event: MessageEvent<RouteResponse>) => void;
type ErrorListener = (event: Event) => void;

/**
 * Stands in for a Web Worker running routing.worker.ts: answers asynchronously
 * after `delayMs`. Requests go through structuredClone, as with a real worker.
 */
export class InProcessWorker implements RoutingWorker {
  readonly requests: RouteRequest[] = [];
  delayMs = 5;
  /** Like a worker whose script did not load: requests are never answered. */
  silent = false;
  /** Answer every request with this error, like a routing run that failed in the worker. */
  answerError: string | undefined;
  private readonly listeners = new Set<WorkerListener>();
  private readonly errorListeners = new Set<ErrorListener>();

  postMessage(request: RouteRequest): void {
    const copy = structuredClone(request); // throws for functions and other uncloneable options
    this.requests.push(copy);
    if (this.silent) return;
    setTimeout(async () => {
      const response = this.answerError ? { id: copy.id, error: this.answerError } : await answerRouteRequest(copy);
      for (const listener of this.listeners) listener({ data: response } as MessageEvent<RouteResponse>);
    }, this.delayMs);
  }

  /** Fires `error` like a worker whose script failed to load. */
  fail(message: string): void {
    const event = Object.assign(new Event('error'), { message });
    for (const listener of this.errorListeners) listener(event);
  }

  addEventListener(type: 'message', listener: WorkerListener): void;
  addEventListener(type: 'error' | 'messageerror', listener: ErrorListener): void;
  addEventListener(type: string, listener: WorkerListener | ErrorListener): void {
    if (type === 'message') this.listeners.add(listener as WorkerListener);
    else this.errorListeners.add(listener as ErrorListener);
  }

  removeEventListener(type: 'message', listener: WorkerListener): void;
  removeEventListener(type: 'error' | 'messageerror', listener: ErrorListener): void;
  removeEventListener(type: string, listener: WorkerListener | ErrorListener): void {
    if (type === 'message') this.listeners.delete(listener as WorkerListener);
    else this.errorListeners.delete(listener as ErrorListener);
  }
}
