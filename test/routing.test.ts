import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import cytoscape from 'cytoscape';
import register, {
  loadLibavoid,
  EdgeRouter,
  routeToEdgeStyle,
  edgeStyleToPoints,
  computeDockingPorts,
  spreadPorts,
} from '../src';
import type { Avoid as AvoidInstance, GraphEdge, GraphModel, GraphNode, Point, RoutingOptions } from '../src';

interface Rect {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

let Avoid: AvoidInstance;
before(async () => {
  Avoid = await loadLibavoid();
  register(cytoscape);
});

const box = (n: GraphNode, pad = 0): Rect => ({
  x1: n.x - n.width / 2 - pad,
  x2: n.x + n.width / 2 + pad,
  y1: n.y - n.height / 2 - pad,
  y2: n.y + n.height / 2 + pad,
});

// does the axis-aligned segment a-b cross the open interior of rect r?
function segmentHitsRect(a: Point, b: Point, r: Rect): boolean {
  const x1 = Math.min(a.x, b.x),
    x2 = Math.max(a.x, b.x),
    y1 = Math.min(a.y, b.y),
    y2 = Math.max(a.y, b.y);
  return x1 < r.x2 && x2 > r.x1 && y1 < r.y2 && y2 > r.y1;
}

const obstacleModel: GraphModel = {
  nodes: [
    { id: 'a', x: 0, y: 0, width: 60, height: 40 },
    { id: 'b', x: 300, y: 0, width: 60, height: 40 },
    { id: 'wall', x: 150, y: 0, width: 40, height: 200 },
  ],
  edges: [{ id: 'ab', source: 'a', target: 'b', width: 4 }],
};

test('orthogonal routes avoid obstacles and only use axis-aligned segments', () => {
  const routes = new EdgeRouter(Avoid).route(obstacleModel);
  const pts = routes.get('ab');
  assert.ok(pts && pts.length >= 4, `expected a detour, got ${JSON.stringify(pts)}`);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1],
      b = pts[i];
    assert.ok(a.x === b.x || a.y === b.y, `segment ${i} not orthogonal`);
    assert.ok(!segmentHitsRect(a, b, box(obstacleModel.nodes[2])), `segment ${i} crosses the wall`);
  }
});

test('auto ports start and end on the node border', () => {
  const pts = new EdgeRouter(Avoid).route(obstacleModel).get('ab');
  assert.ok(pts);
  const onBorder = (p: Point, n: GraphNode): boolean => {
    const r = box(n);
    const inside = p.x >= r.x1 - 0.01 && p.x <= r.x2 + 0.01 && p.y >= r.y1 - 0.01 && p.y <= r.y2 + 0.01;
    const edge =
      [r.x1, r.x2].some((v) => Math.abs(p.x - v) < 0.01) || [r.y1, r.y2].some((v) => Math.abs(p.y - v) < 0.01);
    return inside && edge;
  };
  assert.ok(onBorder(pts[0], obstacleModel.nodes[0]));
  assert.ok(onBorder(pts[pts.length - 1], obstacleModel.nodes[1]));
});

test('docking ports are stacked by edge width on the flow sides without overlap', () => {
  const model: GraphModel = {
    nodes: [
      { id: 's', x: 0, y: 0, width: 40, height: 120 },
      { id: 't1', x: 300, y: -100, width: 40, height: 60 },
      { id: 't2', x: 300, y: 0, width: 40, height: 60 },
      { id: 't3', x: 300, y: 100, width: 40, height: 60 },
    ],
    edges: [
      { id: 'e3', source: 's', target: 't3', width: 30 },
      { id: 'e1', source: 's', target: 't1', width: 10 },
      { id: 'e2', source: 's', target: 't2', width: 20 },
    ],
  };
  const opts: Partial<RoutingOptions> = { ports: 'docking', flowDirection: 'right', portSpacing: 2 };
  const ports = computeDockingPorts(model, opts);
  // sorted top -> bottom by target y: e1, e2, e3
  const o = ['e1', 'e2', 'e3'].map((id) => (ports.get(id)?.source.offset ?? NaN) * 120);
  assert.ok(o[0] < o[1] && o[1] < o[2]);
  assert.ok(Math.abs(o[1] - o[0] - (5 + 2 + 10)) < 1e-9, 'e1/e2 bands touch with spacing');
  assert.ok(Math.abs(o[2] - o[1] - (10 + 2 + 15)) < 1e-9, 'e2/e3 bands touch with spacing');

  const routes = new EdgeRouter(Avoid, opts).route(model);
  for (const [id, pts] of routes) {
    assert.equal(pts[0].x, 20, `${id} leaves on the right side`);
    assert.equal(pts[pts.length - 1].x, 280, `${id} enters on the left side`);
  }
  const e1 = routes.get('e1');
  assert.ok(e1);
  assert.ok(Math.abs(e1[0].y - (o[0] - 60)) < 1e-6, 'route starts at the computed port');
});

test('docking ports are squeezed when the edges do not fit onto a side', () => {
  const model: GraphModel = {
    nodes: [
      { id: 's', x: 0, y: 0, width: 40, height: 20 },
      { id: 't', x: 200, y: 0, width: 40, height: 20 },
    ],
    edges: [
      { id: 'a', source: 's', target: 't', width: 30 },
      { id: 'b', source: 's', target: 't', width: 30 },
    ],
  };
  const ports = computeDockingPorts(model, { flowDirection: 'right', portSpacing: 0 });
  for (const p of ports.values()) assert.ok(p.source.offset >= 0 && p.source.offset <= 1);
  assert.notEqual(ports.get('a')?.source.offset, ports.get('b')?.source.offset);
});

test('spreadPorts centres the stack and keeps the spacing', () => {
  // widths 10 + 20 with spacing 2 = 32 px, centred on a 100 px side: starts at 34
  assert.deepEqual(spreadPorts([10, 20], 100, 2), [0.39, 0.56]);
  assert.deepEqual(spreadPorts([10], 0, 2), [0.5], 'empty side');
});

test('instances do not share nested options with the defaults', () => {
  const router = new EdgeRouter(Avoid, {});
  router.options.routingParameters.crossingPenalty = 1;
  assert.equal(new EdgeRouter(Avoid).options.routingParameters.crossingPenalty, undefined);
});

test('route -> cytoscape segment style round trip is exact', () => {
  const pts = [
    { x: 30, y: -12 },
    { x: 71, y: -12 },
    { x: 71, y: -154 },
    { x: 270, y: -154 },
  ];
  const style = routeToEdgeStyle(pts, { x: 0, y: 0 }, { x: 300, y: -150 });
  assert.ok(style);
  assert.equal(style['curve-style'], 'segments');
  assert.equal(style['source-endpoint'], '30px -12px');
  const back = edgeStyleToPoints(style, { x: 0, y: 0 }, { x: 300, y: -150 });
  back.forEach((p, i) => {
    assert.ok(Math.abs(p.x - pts[i].x) < 0.01 && Math.abs(p.y - pts[i].y) < 0.01, `point ${i}: ${JSON.stringify(p)}`);
  });
});

test('straight routes still produce a valid segments style', () => {
  const style = routeToEdgeStyle(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    { x: -10, y: 0 },
    { x: 110, y: 0 },
    5,
  );
  assert.ok(style);
  assert.equal(style['curve-style'], 'round-segments');
  assert.equal(style['segment-weights'], '0.5');
  assert.equal(style['segment-distances'], '0');
});

test('cy.libavoid() styles edges, re-routes on move and restores on destroy', async () => {
  const cy = cytoscape({
    headless: true,
    styleEnabled: true,
    layout: { name: 'preset' }, // the default 'null' layout would move every node to (0, 0)
    elements: [
      { data: { id: 'a' }, position: { x: 0, y: 0 } },
      { data: { id: 'b' }, position: { x: 300, y: 0 } },
      { data: { id: 'c' }, position: { x: 150, y: 0 } },
      { data: { id: 'ab', source: 'a', target: 'b' } },
    ],
    style: [
      { selector: 'node', style: { width: 40, height: 40, shape: 'rectangle' } },
      { selector: 'edge', style: { width: 3, 'curve-style': 'taxi' } },
    ],
  });
  let events = 0;
  cy.on('avoidrouted', () => events++);
  const routing = cy.libavoid({ avoidLib: Avoid });
  await routing.ready;
  assert.equal(cy.libavoid(), routing, 'no-arg call returns the instance');

  const edge = cy.$id('ab');
  assert.equal(edge.style('curve-style'), 'segments');
  const before = routing.getRoute('ab');
  assert.ok(before && before.length >= 4, 'routed around c');

  cy.$id('c').position({ x: 150, y: 300 }); // move obstacle out of the way
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(routing.getRoute(edge)?.length, 2, 'straight after obstacle moved');
  assert.ok(events >= 2);

  routing.destroy();
  assert.equal(edge.style('curve-style'), 'taxi', 'original stylesheet restored');
  assert.equal(cy.scratch('_libavoid'), undefined);
  cy.destroy();
});

test('live routing settles with compound nodes and ignores changes that move nothing', async () => {
  // with compounds, setting edge styles fires 'style' on all nodes, which used to re-route forever
  const cy = cytoscape({
    headless: true,
    styleEnabled: true,
    layout: { name: 'preset' },
    elements: [
      { data: { id: 'g1' } },
      { data: { id: 'g2' } },
      { data: { id: 'a', parent: 'g1' }, position: { x: 0, y: 0 } },
      { data: { id: 'b', parent: 'g2' }, position: { x: 300, y: 0 } },
      { data: { id: 'c' }, position: { x: 150, y: 0 } },
      { data: { id: 'ab', source: 'a', target: 'b' } },
    ],
    style: [
      { selector: 'node', style: { width: 40, height: 40, shape: 'rectangle' } },
      { selector: 'edge', style: { width: 3, 'curve-style': 'taxi' } },
    ],
  });
  let events = 0;
  cy.on('avoidrouted', () => events++);
  const routing = cy.libavoid({ avoidLib: Avoid });
  const tick = () => new Promise((r) => setTimeout(r, 30));
  try {
    await routing.ready;
    await tick();
    await tick();
    assert.equal(events, 1, 'no re-routes after the initial one');

    cy.$id('a').data('value', 42); // live data, same geometry
    await tick();
    assert.equal(events, 1, 'data change without geometry change does not re-route');

    cy.$id('c').position({ x: 150, y: 300 });
    await tick();
    assert.equal(events, 2, 'moving an obstacle re-routes once');
    assert.equal(routing.getRoute('ab')?.length, 2);

    // rerouteOnDrag: false must also hold back re-routes from the style events a drag fires in compound graphs
    routing.setOptions({ rerouteOnDrag: false });
    events = 0;
    const a = cy.$id('a');
    (a[0] as unknown as { _private: { grabbed: boolean } })._private.grabbed = true; // headless has no mouse
    a.position({ x: 0, y: 100 });
    a.addClass('dragging');
    await tick();
    assert.equal(events, 0, 'no re-route while a node is grabbed');
    (a[0] as unknown as { _private: { grabbed: boolean } })._private.grabbed = false;
    a.emit('free');
    await tick();
    assert.equal(events, 1, 're-routes on release');
  } finally {
    cy.destroy(); // also stops a runaway re-route loop, so a regression fails instead of hanging
  }
});

test('rebuild performance for a mid-sized flow graph', () => {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (let col = 0; col < 8; col++)
    for (let row = 0; row < 8; row++)
      nodes.push({ id: `n${col}_${row}`, x: col * 220, y: row * 120, width: 60, height: 50 });
  let k = 0;
  for (let col = 0; col < 7; col++)
    for (let row = 0; row < 8; row++) {
      edges.push({
        id: `e${k++}`,
        source: `n${col}_${row}`,
        target: `n${col + 1}_${(row * 3 + 1) % 8}`,
        width: 2 + (k % 10),
      });
      edges.push({
        id: `e${k++}`,
        source: `n${col}_${row}`,
        target: `n${Math.min(7, col + 2)}_${(row + 5) % 8}`,
        width: 2 + (k % 7),
      });
    }
  for (const ports of ['auto', 'docking'] as const) {
    const t = performance.now();
    const routes = new EdgeRouter(Avoid, { ports }).route({ nodes, edges });
    const ms = performance.now() - t;
    console.log(`  ${ports}: ${nodes.length} nodes, ${routes.size} edges routed in ${ms.toFixed(1)} ms`);
    assert.equal(routes.size, edges.filter((e) => e.source !== e.target).length);
    assert.ok(ms < 2000, `fast enough for live re-routing (${ms.toFixed(0)} ms)`);
  }
});
