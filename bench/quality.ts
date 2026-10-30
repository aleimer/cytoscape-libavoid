// Route quality on the Angular bench graphs and the demo graph: overlapping
// edges, edges through nodes, crossings, bends and length.
//
//   npm run quality                         # all graphs, default options
//   npm run quality -- M '[{},{"edgeSpacing":4}]'
import { COLLAPSIBLE_GROUPS, plantModel } from '../demo/plant-graph';
import { smallModel } from '../demo/small-graph';
import { loadLibavoid } from '../src';
import { EdgeRouter } from '../src';
import type { GraphModel, RoutingOptions } from '../src';
import type { Point } from '../src';
import { buildGraph, NODE_H, NODE_W, SIZES } from './angular/src/app/graph';

export interface Quality
{
  /** Pairs of parallel segments of different edges whose strokes touch, and their shared length (px). */
  overlaps: number;
  overlapLength: number;
  /** Segments that run through a node other than their own source / target. */
  nodeHits: number;
  crossings: number;
  bends: number;
  length: number;
}

interface Segment
{
  edge: string;
  a: Point;
  b: Point;
  width: number;
}

const EPSILON = 0.5;

/** Measures routes of `model`; strokes are as wide as the edge widths in the model. */
export function measure(model: GraphModel, routes: ReadonlyMap<string, Point[]>): Quality
{
  const widths = new Map(model.edges.map((edge) => [edge.id, edge.width ?? 0]));
  const ends = new Map(model.edges.map((edge) => [edge.id, [edge.source, edge.target]]));
  const segments: Segment[] = [];
  let bends = 0;
  let length = 0;
  for (const [edge, points] of routes)
  {
    bends += Math.max(0, points.length - 2);
    for (let i = 1; i < points.length; i++)
    {
      const a = points[i - 1]!;
      const b = points[i]!;
      length += Math.hypot(b.x - a.x, b.y - a.y);
      segments.push({ edge, a, b, width: widths.get(edge) ?? 0 });
    }
  }

  let overlaps = 0;
  let overlapLength = 0;
  let crossings = 0;
  for (let i = 0; i < segments.length; i++)
  {
    for (let j = i + 1; j < segments.length; j++)
    {
      const s = segments[i]!;
      const t = segments[j]!;
      if (s.edge === t.edge)
      {
        continue;
      }
      const shared = sharedRun(s, t);
      if (shared > 1)
      {
        overlaps++;
        overlapLength += shared;
      }
      else if (properlyCross(s, t))
      {
        crossings++;
      }
    }
  }

  let nodeHits = 0;
  for (const segment of segments)
  {
    const own = ends.get(segment.edge) ?? [];
    for (const node of model.nodes)
    {
      if (own.includes(node.id))
      {
        continue;
      }
      if (segmentHitsBox(segment, node.x, node.y, node.width / 2 - EPSILON, node.height / 2 - EPSILON))
      {
        nodeHits++;
      }
    }
  }
  return { overlaps, overlapLength: Math.round(overlapLength), nodeHits, crossings, bends, length: Math.round(length) };
}

const horizontal = (s: Segment) => Math.abs(s.a.y - s.b.y) < EPSILON;
const vertical = (s: Segment) => Math.abs(s.a.x - s.b.x) < EPSILON;

/** Length along which two parallel axis-aligned segments run so close that their strokes touch. */
function sharedRun(s: Segment, t: Segment): number
{
  const gap = (s.width + t.width) / 2;
  if (horizontal(s) && horizontal(t) && Math.abs(s.a.y - t.a.y) < gap - EPSILON)
  {
    return rangeOverlap(s.a.x, s.b.x, t.a.x, t.b.x);
  }
  if (vertical(s) && vertical(t) && Math.abs(s.a.x - t.a.x) < gap - EPSILON)
  {
    return rangeOverlap(s.a.y, s.b.y, t.a.y, t.b.y);
  }
  return 0;
}

function rangeOverlap(a1: number, a2: number, b1: number, b2: number): number
{
  return Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2));
}

/** True for an X-shaped crossing; touching ends and T-junctions do not count. */
function properlyCross(s: Segment, t: Segment): boolean
{
  const d = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = d(s.a, s.b, t.a);
  const d2 = d(s.a, s.b, t.b);
  const d3 = d(t.a, t.b, s.a);
  const d4 = d(t.a, t.b, s.b);
  return d1 * d2 < -EPSILON && d3 * d4 < -EPSILON;
}

/** Does the segment pass through the box (centre cx / cy, half sizes hw / hh)? Liang-Barsky clipping. */
function segmentHitsBox(segment: Segment, cx: number, cy: number, hw: number, hh: number): boolean
{
  const { a, b } = segment;
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const edges: Array<[number, number]> = [
    [-dx, a.x - (cx - hw)],
    [dx, cx + hw - a.x],
    [-dy, a.y - (cy - hh)],
    [dy, cy + hh - a.y],
  ];
  for (const [p, q] of edges)
  {
    if (p === 0)
    {
      if (q < 0)
      {
        return false;
      }
      continue;
    }
    const r = q / p;
    if (p < 0)
    {
      t0 = Math.max(t0, r);
    }
    else
    {
      t1 = Math.min(t1, r);
    }
    if (t0 > t1)
    {
      return false;
    }
  }
  return t1 - t0 > 1e-6;
}

/** The process nodes and flows of a bench graph; groups are not obstacles. Edge widths as drawn there. */
export function benchModel(sizeName: string): GraphModel
{
  const size = SIZES[sizeName];
  if (!size)
  {
    throw new Error(`unknown size "${sizeName}"`);
  }
  const model: GraphModel = { nodes: [], edges: [] };
  for (const element of buildGraph(size))
  {
    const data = element.data as { id: string; source?: string; target?: string; flow?: number; };
    if (element.group === 'nodes' && element.position)
    {
      model.nodes.push({ id: data.id, ...element.position, width: NODE_W, height: NODE_H });
    }
    else if (element.group === 'edges' && data.source && data.target)
    {
      model.edges.push({ id: data.id, source: data.source, target: data.target, width: data.flow });
    }
  }
  return model;
}

if (import.meta.main)
{
  const [only, variantsJson = '[{}]'] = process.argv.slice(2);
  const variants: Array<Partial<RoutingOptions>> = JSON.parse(variantsJson);
  const graphs: Array<[string, GraphModel]> = [
    ['demo', smallModel()],
    ['plant', plantModel()],
    ['plant collapsed', plantModel({}, new Set(COLLAPSIBLE_GROUPS))],
    ['S', benchModel('S')],
    ['M', benchModel('M')],
  ];
  const avoid = await loadLibavoid();
  console.log(
    'graph            options                                    overlaps (px)  node hits  crossings  bends  length',
  );
  for (const [name, model] of graphs)
  {
    if (only && only !== name)
    {
      continue;
    }
    for (const variant of variants)
    {
      const q = measure(model, new EdgeRouter(avoid, variant).route(model));
      console.log(
        `${name.padEnd(16)} ${JSON.stringify(variant).padEnd(42)} ${
          `${q.overlaps} (${q.overlapLength})`.padStart(13)
        }` +
          `  ${String(q.nodeHits).padStart(9)}  ${String(q.crossings).padStart(9)}  ${
            String(q.bends).padStart(5)
          }  ${q.length}`,
      );
    }
  }
}
