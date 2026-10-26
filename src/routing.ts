// Routing logic: turns a plain graph model into routed polylines. Knows
// nothing about Cytoscape, so it can be tested in Node and reused with other
// renderers.

import { LibavoidRouter, loadLibavoid, SIDES } from './libavoid';
import type {
  Avoid,
  ConnRef,
  Point,
  RoutingOptionName,
  RoutingParameterName,
  RoutingType,
  ShapeRef,
  Side,
} from './libavoid';

export type FlowDirection = 'right' | 'left' | 'down' | 'up';

/** A node: obstacle for all edges and endpoint of its own. */
export interface GraphNode {
  id: string;
  /** Centre x. */
  x: number;
  /** Centre y. */
  y: number;
  width: number;
  height: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  /** Stroke width, used to space docking ports and parallel segments. */
  width?: number | undefined;
  /** Docking ports: side the edge leaves its source, instead of the one given by `flowDirection`. */
  sourceSide?: Side | undefined;
  /** Docking ports: side the edge enters its target, instead of the one given by `flowDirection`. */
  targetSide?: Side | undefined;
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface RoutingOptions {
  /**
   * `'orthogonal'`: horizontal and vertical segments only.
   * `'polyline'`: straight segments at any angle.
   * @default 'orthogonal'
   */
  routingType: RoutingType;
  /**
   * `'auto'`: one shared pin in the middle of each node side; libavoid picks the side.
   * `'docking'`: every edge gets its own docking port on the outgoing side of its
   * source and the incoming side of its target, stacked by edge width and sorted
   * so that edges do not cross right at the node.
   * @default 'auto'
   */
  ports: 'auto' | 'docking';
  /** Docking ports: direction edges run in, e.g. `'right'` = leave on the right, enter on the left. @default 'right' */
  flowDirection: FlowDirection;
  /** Docking ports: gap between neighbouring ports on a side (px). @default 2 */
  portSpacing: number;
  /** Clearance kept around nodes (px). @default 12 */
  shapeBufferDistance: number;
  /** Distance between parallel segments (px); `'auto'` = widest edge + `portSpacing`. @default 'auto' */
  idealNudgingDistance: number | 'auto';
  /** Spread apart edge ends that share a pin; `'auto'` = on for `ports: 'auto'`. @default 'auto' */
  nudgeConnectedSegments: boolean | 'auto';
  /** Raw libavoid routing parameters, e.g. `{ crossingPenalty: 200 }`. @default {} */
  routingParameters: Partial<Record<RoutingParameterName, number>>;
  /**
   * Raw libavoid routing options, e.g. `{ nudgeSharedPathsWithCommonEndPoint: true }`.
   * `performUnifyingNudgingPreprocessingStep` is off unless set here, because it is very slow.
   * @default {}
   */
  routingOptions: Partial<Record<RoutingOptionName, boolean>>;
}

/** Where an edge docks onto a node: `offset` runs from 0 to 1 along the side. */
export interface DockingPort {
  side: Side;
  offset: number;
}

export interface EdgePorts {
  source: DockingPort;
  target: DockingPort;
}

export const defaultRoutingOptions: Readonly<RoutingOptions> = Object.freeze({
  routingType: 'orthogonal',
  ports: 'auto',
  flowDirection: 'right',
  portSpacing: 2,
  shapeBufferDistance: 12,
  idealNudgingDistance: 'auto',
  nudgeConnectedSegments: 'auto',
  routingParameters: Object.freeze({}),
  routingOptions: Object.freeze({}),
});

/** Only the routing options of a larger options object, e.g. to send them to a worker. */
export function pickRoutingOptions(options: RoutingOptions): RoutingOptions {
  const picked: Partial<Record<keyof RoutingOptions, unknown>> = {};
  for (const key of Object.keys(defaultRoutingOptions) as Array<keyof RoutingOptions>) picked[key] = options[key];
  return picked as RoutingOptions;
}

/** Merges options onto the defaults; the nested objects are copied so they are never shared. */
export function resolveRoutingOptions<T extends RoutingOptions>(defaults: Readonly<T>, options: Partial<T>): T {
  const merged = { ...defaults, ...options };
  merged.routingParameters = { ...merged.routingParameters };
  merged.routingOptions = { ...merged.routingOptions };
  return merged;
}

// Which side an edge leaves its source / enters its target for each flow direction.
const FLOW_SIDES: Record<FlowDirection, { out: Side; in: Side }> = {
  right: { out: 'right', in: 'left' },
  left: { out: 'left', in: 'right' },
  down: { out: 'bottom', in: 'top' },
  up: { out: 'top', in: 'bottom' },
};

/** With `ports: 'auto'` every edge attaches to the same four pins of a node. */
const SHARED_PIN_CLASS = 1;
const MIN_NUDGING_DISTANCE = 4;
/** libavoid needs a non-empty rectangle. */
const MIN_SHAPE_SIZE = 1;

/** Routes the edges of a graph model around its nodes with libavoid. */
export class EdgeRouter {
  readonly options: RoutingOptions;
  private readonly avoid: Avoid;

  /** @param avoid initialised libavoid instance, see loadLibavoid() */
  constructor(avoid: Avoid, options: Partial<RoutingOptions> = {}) {
    this.avoid = avoid;
    this.options = resolveRoutingOptions(defaultRoutingOptions, options);
  }

  /**
   * Edges with a missing endpoint and loops are skipped.
   *
   * @returns edge id -> route points, from the source end to the target end
   */
  route(model: GraphModel): Map<string, Point[]> {
    const edges = routableEdges(model);
    const router = new LibavoidRouter(this.avoid, this.options.routingType);
    try {
      this.configure(router, edges);
      const shapes = this.addShapes(router, model.nodes);
      const connectors = this.addConnectors(router, shapes, { nodes: model.nodes, edges });
      router.route();
      return readRoutes(router, connectors);
    } finally {
      router.dispose();
    }
  }

  private get usesDockingPorts(): boolean {
    return this.options.ports === 'docking';
  }

  private configure(router: LibavoidRouter, edges: GraphEdge[]): void {
    const { options } = this;
    const widest = edges.reduce((max, edge) => Math.max(max, edge.width || 0), 0);
    const nudgingDistance =
      options.idealNudgingDistance === 'auto'
        ? Math.max(MIN_NUDGING_DISTANCE, widest + options.portSpacing)
        : options.idealNudgingDistance;
    const nudgeConnected =
      options.nudgeConnectedSegments === 'auto' ? !this.usesDockingPorts : options.nudgeConnectedSegments;

    router.setParameter('shapeBufferDistance', options.shapeBufferDistance);
    router.setParameter('idealNudgingDistance', nudgingDistance);
    router.setOption('nudgeOrthogonalSegmentsConnectedToShapes', nudgeConnected);
    // libavoid's default; costs ~98% of the routing time (64 nodes / 112 edges:
    // 3.4 s -> 50 ms, docking ports 16 s -> 140 ms) for slightly fewer bends.
    router.setOption('performUnifyingNudgingPreprocessingStep', false);

    // raw values last, so they override everything above
    for (const [name, value] of Object.entries(options.routingParameters)) {
      if (value !== undefined) router.setParameter(name, value);
    }
    for (const [name, value] of Object.entries(options.routingOptions)) {
      if (value !== undefined) router.setOption(name, value);
    }
  }

  private addShapes(router: LibavoidRouter, nodes: GraphNode[]): Map<string, ShapeRef> {
    const shapes = new Map<string, ShapeRef>();
    for (const node of nodes) {
      const width = Math.max(node.width, MIN_SHAPE_SIZE);
      const height = Math.max(node.height, MIN_SHAPE_SIZE);
      const shape = router.addShape(node, width, height);
      if (!this.usesDockingPorts) {
        for (const side of SIDES)
          router.addPin(shape, { classId: SHARED_PIN_CLASS, side, offset: 0.5, exclusive: false });
      }
      shapes.set(node.id, shape);
    }
    return shapes;
  }

  /** `model.edges` must be routable, see routableEdges(). */
  private addConnectors(
    router: LibavoidRouter,
    shapes: Map<string, ShapeRef>,
    model: GraphModel,
  ): Map<string, ConnRef> {
    const ports = this.usesDockingPorts ? computeDockingPorts(model, this.options) : undefined;
    const connectors = new Map<string, ConnRef>();
    let nextPinClass = SHARED_PIN_CLASS + 1;

    for (const edge of model.edges) {
      const source = shapes.get(edge.source)!;
      const target = shapes.get(edge.target)!;
      const edgePorts = ports?.get(edge.id);
      if (!edgePorts) {
        connectors.set(edge.id, router.connect(source, SHARED_PIN_CLASS, target, SHARED_PIN_CLASS));
        continue;
      }
      // a docking port is a pin class of its own with exactly one pin
      const sourcePin = nextPinClass++;
      const targetPin = nextPinClass++;
      router.addPin(source, { classId: sourcePin, ...edgePorts.source, exclusive: true });
      router.addPin(target, { classId: targetPin, ...edgePorts.target, exclusive: true });
      connectors.set(edge.id, router.connect(source, sourcePin, target, targetPin));
    }
    return connectors;
  }
}

/** Edges whose endpoints both exist and differ. */
function routableEdges(model: GraphModel): GraphEdge[] {
  const nodeIds = new Set(model.nodes.map((node) => node.id));
  return model.edges.filter(
    (edge) => edge.source !== edge.target && nodeIds.has(edge.source) && nodeIds.has(edge.target),
  );
}

function readRoutes(router: LibavoidRouter, connectors: Map<string, ConnRef>): Map<string, Point[]> {
  const routes = new Map<string, Point[]>();
  for (const [edgeId, connector] of connectors) routes.set(edgeId, simplify(router.pointsOf(connector)));
  return routes;
}

// --- docking ports -------------------------------------------------------------

/** One edge end waiting for its place on a node side. */
interface PortSlot {
  port: DockingPort;
  edge: GraphEdge;
  /** The node at the other end of the edge; the slots of a side are sorted by its position along the side. */
  otherNode: GraphNode;
}

/**
 * Places a docking port for both ends of every edge: on the outgoing side of
 * the source and the incoming side of the target. The ports on a side are
 * stacked by edge width and sorted by the position of the node at the other
 * end, so edges do not cross right at the node. Edges with a missing endpoint
 * are skipped.
 *
 * @returns edge id -> source / target port
 */
export function computeDockingPorts(model: GraphModel, options: Partial<RoutingOptions> = {}): Map<string, EdgePorts> {
  const { flowDirection = defaultRoutingOptions.flowDirection, portSpacing = defaultRoutingOptions.portSpacing } =
    options;
  const sides: { out: Side; in: Side } | undefined = FLOW_SIDES[flowDirection];
  if (!sides) throw new Error(`cytoscape-libavoid: unknown flowDirection "${flowDirection}"`);

  const nodes = new Map(model.nodes.map((node) => [node.id, node]));
  const slotsByNode = new Map<GraphNode, Partial<Record<Side, PortSlot[]>>>();
  const addSlot = (node: GraphNode, slot: PortSlot): void => {
    let bySide = slotsByNode.get(node);
    if (!bySide) slotsByNode.set(node, (bySide = {}));
    (bySide[slot.port.side] ??= []).push(slot);
  };

  const ports = new Map<string, EdgePorts>();
  for (const edge of model.edges) {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target) continue;
    // the offsets are placeholders until the ports of each side are spread out below
    const edgePorts: EdgePorts = {
      source: { side: edge.sourceSide ?? sides.out, offset: 0.5 },
      target: { side: edge.targetSide ?? sides.in, offset: 0.5 },
    };
    ports.set(edge.id, edgePorts);
    addSlot(source, { port: edgePorts.source, edge, otherNode: target });
    addSlot(target, { port: edgePorts.target, edge, otherNode: source });
  }

  for (const [node, bySide] of slotsByNode) {
    for (const side of SIDES) {
      const slots = bySide[side];
      if (!slots) continue;
      const vertical = side === 'left' || side === 'right';
      slots.sort(vertical ? compareSlotsBy('y') : compareSlotsBy('x'));
      const sideLength = vertical ? node.height : node.width;
      const widths = slots.map((slot) => slot.edge.width || 0);
      const offsets = spreadPorts(widths, sideLength, portSpacing);
      slots.forEach((slot, i) => (slot.port.offset = offsets[i] ?? 0.5));
    }
  }
  return ports;
}

/** Orders the slots of a side by where their other node lies along it (x for top / bottom, y for left / right). */
const compareSlotsBy =
  (axis: 'x' | 'y') =>
  (a: PortSlot, b: PortSlot): number =>
    a.otherNode[axis] - b.otherNode[axis] ||
    a.otherNode.id.localeCompare(b.otherNode.id) ||
    a.edge.id.localeCompare(b.edge.id);

/**
 * Stacks ports of the given widths along a side, centred and `spacing` apart,
 * and squeezes the stack if it does not fit.
 *
 * @returns the centre of each port as a fraction (0..1) of the side length
 */
export function spreadPorts(widths: readonly number[], sideLength: number, spacing: number): number[] {
  if (!(sideLength > 0)) return widths.map(() => 0.5);
  const needed = widths.reduce((sum, width) => sum + width, 0) + spacing * (widths.length - 1);
  const scale = needed > sideLength ? sideLength / needed : 1;
  let cursor = (sideLength - needed * scale) / 2;
  return widths.map((width) => {
    const scaled = width * scale;
    const centre = cursor + scaled / 2;
    cursor += scaled + spacing * scale;
    return clamp(centre / sideLength, 0, 1);
  });
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

// --- route clean-up ------------------------------------------------------------

/** libavoid returns float noise such as 12.000000001; coordinates are rounded to 1/1000 px. */
const COORDINATE_PRECISION = 1000;
const COLLINEAR_TOLERANCE = 1e-6;

const roundCoordinate = (value: number): number => Math.round(value * COORDINATE_PRECISION) / COORDINATE_PRECISION;

/** Rounds away float noise and drops duplicate points and points in the middle of a straight run. */
export function simplify(points: readonly Point[]): Point[] {
  const result: Point[] = [];
  for (const { x, y } of points) {
    const point = { x: roundCoordinate(x), y: roundCoordinate(y) };
    const last = result[result.length - 1];
    if (last && last.x === point.x && last.y === point.y) continue;
    const beforeLast = result[result.length - 2];
    if (last && beforeLast && continuesStraight(beforeLast, last, point)) {
      result[result.length - 1] = point;
      continue;
    }
    result.push(point);
  }
  return result;
}

/** True if b lies on the straight line from a to c and the path does not turn back at b. */
function continuesStraight(a: Point, b: Point, c: Point): boolean {
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const sameDirection = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= 0;
  return Math.abs(cross) < COLLINEAR_TOLERANCE && sameDirection;
}

// --- routing in a Web Worker ---------------------------------------------------

/** Message from the plugin to routing.worker.ts. */
export interface RouteRequest {
  id: number;
  /** Absolute URL of libavoid.wasm; only the first request loads it. */
  wasmUrl?: string | undefined;
  model: GraphModel;
  options: RoutingOptions;
}

/** Answer of routing.worker.ts to a RouteRequest with the same id. */
export type RouteResponse =
  { id: number; routes: Array<[edgeId: string, points: Point[]]>; routingMs: number } | { id: number; error: string };

/** Routes one request, loading libavoid on first use. Runs inside routing.worker.ts. */
export async function answerRouteRequest(request: RouteRequest): Promise<RouteResponse> {
  try {
    const avoid = await loadLibavoid(request.wasmUrl);
    const start = performance.now();
    const routes = new EdgeRouter(avoid, request.options).route(request.model);
    return { id: request.id, routes: [...routes], routingMs: performance.now() - start };
  } catch (error) {
    return { id: request.id, error: error instanceof Error ? error.message : String(error) };
  }
}

/** The part of a Web Worker used here; a `Worker` running routing.worker.ts fits. */
export interface RoutingWorker {
  postMessage(request: RouteRequest): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<RouteResponse>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<RouteResponse>) => void): void;
}

export interface WorkerRouteResult {
  routes: Map<string, Point[]>;
  /** Time spent in libavoid inside the worker. */
  routingMs: number;
}

/** Request ids are unique across all WorkerRouters, so several of them can share one worker. */
let lastRequestId = 0;

/**
 * Sends routing requests to a worker running routing.worker.ts: the
 * asynchronous counterpart of EdgeRouter. Answers are matched by request id.
 */
export class WorkerRouter {
  private readonly worker: RoutingWorker;
  private readonly pending = new Map<number, PromiseWithCallbacks<WorkerRouteResult>>();

  constructor(worker: RoutingWorker) {
    this.worker = worker;
    worker.addEventListener('message', this.onMessage);
  }

  /** True while a request is unanswered. */
  get busy(): boolean {
    return this.pending.size > 0;
  }

  /** Rejects with the worker's error message if routing fails there. */
  route(request: Omit<RouteRequest, 'id'>): Promise<WorkerRouteResult> {
    const id = ++lastRequestId;
    const answer = promiseWithCallbacks<WorkerRouteResult>();
    this.pending.set(id, answer);
    this.worker.postMessage({ ...request, id });
    return answer.promise;
  }

  /** Stops listening; unanswered requests are rejected. The worker itself keeps running. */
  dispose(): void {
    this.worker.removeEventListener('message', this.onMessage);
    for (const answer of this.pending.values()) answer.reject(new Error('cytoscape-libavoid: worker router disposed'));
    this.pending.clear();
  }

  private readonly onMessage = (event: MessageEvent<RouteResponse>): void => {
    const response = event.data;
    const answer = this.pending.get(response.id);
    if (!answer) return; // a request of another WorkerRouter
    this.pending.delete(response.id);
    if ('error' in response) {
      answer.reject(new Error(`cytoscape-libavoid: ${response.error.replace(/^cytoscape-libavoid: /, '')}`));
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
