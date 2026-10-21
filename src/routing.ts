// Pure routing core: takes a plain graph model, feeds it to libavoid and
// returns the routed polylines. Knows nothing about Cytoscape, so it can be
// tested in Node and reused with other renderers.

import type { Avoid, ConnRef, Deletable, Point, Router, RoutingOptionName, RoutingParameterName, ShapeRef } from './libavoid.ts';

export type Side = 'top' | 'right' | 'bottom' | 'left';
export type FlowDirection = 'right' | 'left' | 'down' | 'up';

/** x/y are node centres. */
export interface GraphNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  width?: number;
  sourceSide?: Side;
  targetSide?: Side;
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface RoutingOptions {
  routingType: 'orthogonal' | 'polyline';
  ports: 'auto' | 'sankey';
  flowDirection: FlowDirection;
  portSpacing: number;
  shapeBufferDistance: number;
  idealNudgingDistance: number | 'auto';
  nudgeConnectedSegments: boolean | 'auto';
  routingParameters: Partial<Record<RoutingParameterName, number>>;
  routingOptions: Partial<Record<RoutingOptionName, boolean>>;
}

/** offset is the proportional position (0..1) along the side. */
export interface SankeyPort {
  side: Side;
  offset: number;
}

export interface SankeyPorts {
  source: SankeyPort;
  target: SankeyPort;
}

// libavoid ConnDirFlags (not exported as an enum by libavoid-js)
export const DIR = { up: 1, down: 2, left: 4, right: 8, all: 15 } as const;

export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

const SIDE_DIR: Record<Side, number> = { top: DIR.up, bottom: DIR.down, left: DIR.left, right: DIR.right };

// Which side a flow leaves / enters a node for a given flow direction.
const FLOW_SIDES: Record<FlowDirection, { out: Side; in: Side }> = {
  right: { out: 'right', in: 'left' },
  left: { out: 'left', in: 'right' },
  down: { out: 'bottom', in: 'top' },
  up: { out: 'top', in: 'bottom' },
};

const AUTO_PIN_CLASS = 1;

export const defaultRoutingOptions: RoutingOptions = {
  routingType: 'orthogonal', // 'orthogonal' | 'polyline'
  ports: 'auto', // 'auto' | 'sankey'
  flowDirection: 'right', // sankey only: 'right' | 'left' | 'down' | 'up'
  portSpacing: 2, // sankey only: gap between stacked flows on a node side (px)
  shapeBufferDistance: 12, // clearance kept around nodes (px)
  idealNudgingDistance: 'auto', // distance between parallel segments; 'auto' = max edge width + portSpacing
  nudgeConnectedSegments: 'auto', // spread endpoints sharing a pin; 'auto' = true for ports:'auto'
  routingParameters: {}, // raw libavoid RoutingParameter values, e.g. { crossingPenalty: 200 }
  routingOptions: {}, // raw libavoid RoutingOption values, e.g. { nudgeSharedPathsWithCommonEndPoint: true }
  //                     performUnifyingNudgingPreprocessingStep is off by default (very slow); set true here to re-enable
};

interface Slot {
  port: SankeyPort;
  edge: GraphEdge;
  sortKey: number;
  tie: string;
}

/**
 * Computes sankey-style port positions: every edge gets its own slot on the
 * outgoing side of its source and the incoming side of its target. Slots are
 * stacked by edge width and sorted by the position of the opposite node so
 * flows do not cross right at the node. Edges with unknown endpoints are skipped.
 *
 * @returns edge id -> source / target port
 */
export function computeSankeyPorts(model: GraphModel, opts: Partial<RoutingOptions>): Map<string, SankeyPorts> {
  const { flowDirection = 'right', portSpacing = 2 } = opts;
  const sides: { out: Side; in: Side } | undefined = FLOW_SIDES[flowDirection];
  if (!sides) throw new Error(`cytoscape-libavoid: unknown flowDirection "${flowDirection}"`);
  const horizontal = flowDirection === 'right' || flowDirection === 'left';
  const cross = horizontal ? 'y' : 'x';
  const nodes = new Map(model.nodes.map((n) => [n.id, n]));

  const slots = new Map<string, Partial<Record<Side, Slot[]>>>();
  const ports = new Map<string, SankeyPorts>();
  const push = (nodeId: string, side: Side, entry: Slot): void => {
    let bySide = slots.get(nodeId);
    if (!bySide) slots.set(nodeId, (bySide = {}));
    (bySide[side] ||= []).push(entry);
  };

  for (const e of model.edges) {
    const src = nodes.get(e.source);
    const tgt = nodes.get(e.target);
    if (!src || !tgt) continue;
    // offsets are filled in below; every port lands in exactly one slot list
    const p: SankeyPorts = { source: { side: e.sourceSide || sides.out, offset: 0.5 }, target: { side: e.targetSide || sides.in, offset: 0.5 } };
    ports.set(e.id, p);
    push(e.source, p.source.side, { port: p.source, edge: e, sortKey: tgt[cross], tie: e.target });
    push(e.target, p.target.side, { port: p.target, edge: e, sortKey: src[cross], tie: e.source });
  }

  for (const [nodeId, bySide] of slots) {
    const node = nodes.get(nodeId);
    if (!node) continue;
    for (const side of SIDES) {
      const list = bySide[side];
      if (!list) continue;
      list.sort((a, b) => a.sortKey - b.sortKey || a.tie.localeCompare(b.tie) || a.edge.id.localeCompare(b.edge.id));
      const along = side === 'left' || side === 'right' ? node.h : node.w;
      const total = list.reduce((s, it) => s + (it.edge.width || 0), 0) + portSpacing * (list.length - 1);
      // squeeze the stack if it does not fit onto the side
      const scale = total > along && total > 0 ? along / total : 1;
      let cursor = (along - total * scale) / 2;
      for (const it of list) {
        const w = (it.edge.width || 0) * scale;
        const center = cursor + w / 2;
        cursor += w + portSpacing * scale;
        it.port.offset = along > 0 ? clamp(center / along, 0, 1) : 0.5;
      }
    }
  }
  return ports;
}

/**
 * Routes all edges of the model with libavoid.
 *
 * @param Avoid   initialised libavoid-js instance (AvoidLib.getInstance())
 * @param model   edges whose endpoints are missing or that are loops are skipped.
 * @param options see defaultRoutingOptions
 * @returns edge id -> route points (first = source end, last = target end)
 */
export function routeGraph(Avoid: Avoid, model: GraphModel, options: Partial<RoutingOptions> = {}): Map<string, Point[]> {
  const opts: RoutingOptions = { ...defaultRoutingOptions, ...options };
  const nodeIds = new Set(model.nodes.map((n) => n.id));
  const edges = model.edges.filter((e) => e.source !== e.target && nodeIds.has(e.source) && nodeIds.has(e.target));
  const sankey = opts.ports === 'sankey';
  const maxWidth = edges.reduce((m, e) => Math.max(m, e.width || 0), 0);
  const nudging = opts.idealNudgingDistance === 'auto' ? Math.max(4, maxWidth + opts.portSpacing) : opts.idealNudgingDistance;
  const nudgeConnected = opts.nudgeConnectedSegments === 'auto' ? !sankey : opts.nudgeConnectedSegments;

  const flag = opts.routingType === 'polyline' ? Avoid.RouterFlag.PolyLineRouting : Avoid.RouterFlag.OrthogonalRouting;
  const router = new Avoid.Router(flag.value);
  const temps: Deletable[] = [];
  const tmp = <T extends Deletable>(obj: T): T => (temps.push(obj), obj);
  const P = (x: number, y: number) => tmp(new Avoid.Point(x, y));

  try {
    setParam(Avoid, router, 'shapeBufferDistance', opts.shapeBufferDistance);
    setParam(Avoid, router, 'idealNudgingDistance', nudging);
    setOption(Avoid, router, 'nudgeOrthogonalSegmentsConnectedToShapes', nudgeConnected);
    // libavoid's default; costs ~98% of the routing time (64 nodes / 112 edges:
    // 3.4 s -> 50 ms, sankey 16 s -> 140 ms) for slightly fewer bends.
    setOption(Avoid, router, 'performUnifyingNudgingPreprocessingStep', false);
    for (const [k, v] of Object.entries(opts.routingParameters || {})) if (v !== undefined) setParam(Avoid, router, k, v);
    for (const [k, v] of Object.entries(opts.routingOptions || {})) if (v !== undefined) setOption(Avoid, router, k, v);

    const shapes = new Map<string, ShapeRef>();
    for (const n of model.nodes) {
      const rect = tmp(new Avoid.Rectangle(P(n.x, n.y), Math.max(n.w, 1), Math.max(n.h, 1)));
      const shape = new Avoid.ShapeRef(router, rect);
      shapes.set(n.id, shape);
      if (!sankey) {
        // one pin per side, shared by all connectors; libavoid picks the best side
        addPin(Avoid, shape, AUTO_PIN_CLASS, 'top', 0.5, false);
        addPin(Avoid, shape, AUTO_PIN_CLASS, 'right', 0.5, false);
        addPin(Avoid, shape, AUTO_PIN_CLASS, 'bottom', 0.5, false);
        addPin(Avoid, shape, AUTO_PIN_CLASS, 'left', 0.5, false);
      }
    }

    const ports = sankey ? computeSankeyPorts({ nodes: model.nodes, edges }, opts) : null;
    let nextClass = AUTO_PIN_CLASS + 1;
    const conns: Array<[string, ConnRef]> = [];
    for (const e of edges) {
      const srcShape = shapes.get(e.source);
      const tgtShape = shapes.get(e.target);
      if (!srcShape || !tgtShape) continue; // cannot happen: edges are filtered above
      let srcClass = AUTO_PIN_CLASS;
      let tgtClass = AUTO_PIN_CLASS;
      const p = ports?.get(e.id);
      if (p) {
        srcClass = nextClass++;
        tgtClass = nextClass++;
        addPin(Avoid, srcShape, srcClass, p.source.side, p.source.offset, true);
        addPin(Avoid, tgtShape, tgtClass, p.target.side, p.target.offset, true);
      }
      const conn = new Avoid.ConnRef(router, tmp(new Avoid.ConnEnd(srcShape, srcClass)), tmp(new Avoid.ConnEnd(tgtShape, tgtClass)));
      conns.push([e.id, conn]);
    }

    router.processTransaction();

    const routes = new Map<string, Point[]>();
    for (const [id, conn] of conns) {
      const route = conn.displayRoute();
      const pts: Point[] = [];
      for (let i = 0; i < route.size(); i++) {
        const p = route.at(i);
        pts.push({ x: p.x, y: p.y });
      }
      routes.set(id, simplify(pts));
    }
    return routes;
  } finally {
    for (const t of temps) t.delete();
    router.delete(); // frees shapes, pins and connectors owned by the router
  }
}

function addPin(Avoid: Avoid, shape: ShapeRef, classId: number, side: Side, offset: number, exclusive: boolean): void {
  const x = side === 'left' ? 0 : side === 'right' ? 1 : offset;
  const y = side === 'top' ? 0 : side === 'bottom' ? 1 : offset;
  const pin = new Avoid.ShapeConnectionPin(shape, classId, x, y, true, 0, SIDE_DIR[side]);
  pin.setExclusive(exclusive);
}

function setParam(Avoid: Avoid, router: Router, name: string, value: number): void {
  const p = Avoid.RoutingParameter[name];
  if (!p) throw new Error(`cytoscape-libavoid: unknown routing parameter "${name}"`);
  router.setRoutingParameter(p, value);
}

function setOption(Avoid: Avoid, router: Router, name: string, value: boolean): void {
  const o = Avoid.RoutingOption[name];
  if (!o) throw new Error(`cytoscape-libavoid: unknown routing option "${name}"`);
  router.setRoutingOption(o, value);
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Rounds away float noise from libavoid and drops duplicate / collinear points. */
export function simplify(points: readonly Point[]): Point[] {
  const pts = points.map((p) => ({ x: round(p.x), y: round(p.y) }));
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    if (last && out.length >= 2) {
      const a = out[out.length - 2];
      const cross = (last.x - a.x) * (p.y - a.y) - (last.y - a.y) * (p.x - a.x);
      const sameDir = (last.x - a.x) * (p.x - last.x) + (last.y - a.y) * (p.y - last.y) >= 0;
      if (Math.abs(cross) < 1e-6 && sameDir) {
        out[out.length - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

const round = (v: number): number => Math.round(v * 1000) / 1000;
