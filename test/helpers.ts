// Shared test helpers (not a test file itself: not matched by *.test.ts).
import cytoscape from 'cytoscape';
import type { Core, ElementDefinition, NodeSingular } from 'cytoscape';
import { answerRouteRequest } from '../src';
import type { GraphNode, Point, RouteRequest, RouteResponse, RoutingWorker } from '../src';

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

/** Headless Cytoscape has no mouse, so grabbing is simulated through the private flag. */
export function setGrabbed(node: NodeSingular, grabbed: boolean): void {
  (node as unknown as { _private: { grabbed: boolean } })._private.grabbed = grabbed;
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

/**
 * Stands in for a Web Worker running routing.worker.ts: answers asynchronously
 * after `delayMs`. Requests go through structuredClone, as with a real worker.
 */
export class InProcessWorker implements RoutingWorker {
  readonly requests: RouteRequest[] = [];
  delayMs = 5;
  private readonly listeners = new Set<WorkerListener>();

  postMessage(request: RouteRequest): void {
    const copy = structuredClone(request); // throws for functions and other uncloneable options
    this.requests.push(copy);
    setTimeout(async () => {
      const response = await answerRouteRequest(copy);
      for (const listener of this.listeners) listener({ data: response } as MessageEvent<RouteResponse>);
    }, this.delayMs);
  }

  addEventListener(_type: 'message', listener: WorkerListener): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: WorkerListener): void {
    this.listeners.delete(listener);
  }
}
