import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { computeDockingPorts, EdgeRouter, loadLibavoid, simplify, spreadPorts } from '../src';
import type { Avoid, GraphEdge, GraphModel, GraphNode, Point, RoutingOptions } from '../src';
import { box, segmentHitsRect } from './helpers';

let avoid: Avoid;
before(async () => {
  avoid = await loadLibavoid();
});

const obstacleModel: GraphModel = {
  nodes: [
    { id: 'a', x: 0, y: 0, width: 60, height: 40 },
    { id: 'b', x: 300, y: 0, width: 60, height: 40 },
    { id: 'wall', x: 150, y: 0, width: 40, height: 200 },
  ],
  edges: [{ id: 'ab', source: 'a', target: 'b', width: 4 }],
};

test('orthogonal routes avoid obstacles and only use axis-aligned segments', () => {
  const points = new EdgeRouter(avoid).route(obstacleModel).get('ab');
  assert.ok(points && points.length >= 4, `expected a detour, got ${JSON.stringify(points)}`);
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    assert.ok(a.x === b.x || a.y === b.y, `segment ${i} not orthogonal`);
    assert.ok(!segmentHitsRect(a, b, box(obstacleModel.nodes[2])), `segment ${i} crosses the wall`);
  }
});

test('auto ports start and end on the node border', () => {
  const points = new EdgeRouter(avoid).route(obstacleModel).get('ab');
  assert.ok(points);
  const onBorder = (p: Point, node: GraphNode): boolean => {
    const r = box(node);
    const inside = p.x >= r.x1 - 0.01 && p.x <= r.x2 + 0.01 && p.y >= r.y1 - 0.01 && p.y <= r.y2 + 0.01;
    const onSide =
      [r.x1, r.x2].some((v) => Math.abs(p.x - v) < 0.01) || [r.y1, r.y2].some((v) => Math.abs(p.y - v) < 0.01);
    return inside && onSide;
  };
  assert.ok(onBorder(points[0], obstacleModel.nodes[0]));
  assert.ok(onBorder(points[points.length - 1], obstacleModel.nodes[1]));
});

test('polyline routes go around the obstacle', () => {
  const points = new EdgeRouter(avoid, { routingType: 'polyline' }).route(obstacleModel).get('ab');
  assert.ok(points && points.length >= 3, 'not a straight line through the wall');
});

test('loops and edges with a missing endpoint are skipped', () => {
  const model: GraphModel = {
    nodes: obstacleModel.nodes,
    edges: [
      ...obstacleModel.edges,
      { id: 'loop', source: 'a', target: 'a' },
      { id: 'dangling', source: 'a', target: 'nowhere' },
    ],
  };
  assert.deepEqual([...new EdgeRouter(avoid).route(model).keys()], ['ab']);
});

test('unknown routing parameters and options are reported by name', () => {
  const badParameter = { routingParameters: { bogus: 1 } } as unknown as Partial<RoutingOptions>;
  assert.throws(() => new EdgeRouter(avoid, badParameter).route(obstacleModel), /unknown routing parameter "bogus"/);
  const badOption = { routingOptions: { bogus: true } } as unknown as Partial<RoutingOptions>;
  assert.throws(() => new EdgeRouter(avoid, badOption).route(obstacleModel), /unknown routing option "bogus"/);
});

test('instances do not share nested options with the defaults', () => {
  const router = new EdgeRouter(avoid, {});
  router.options.routingParameters.crossingPenalty = 1;
  assert.equal(new EdgeRouter(avoid).options.routingParameters.crossingPenalty, undefined);
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
  const options: Partial<RoutingOptions> = { ports: 'docking', flowDirection: 'right', portSpacing: 2 };
  const ports = computeDockingPorts(model, options);
  // sorted top -> bottom by target y: e1, e2, e3
  const offsets = ['e1', 'e2', 'e3'].map((id) => (ports.get(id)?.source.offset ?? NaN) * 120);
  assert.ok(offsets[0] < offsets[1] && offsets[1] < offsets[2]);
  assert.ok(Math.abs(offsets[1] - offsets[0] - (5 + 2 + 10)) < 1e-9, 'e1/e2 touch with spacing');
  assert.ok(Math.abs(offsets[2] - offsets[1] - (10 + 2 + 15)) < 1e-9, 'e2/e3 touch with spacing');

  const routes = new EdgeRouter(avoid, options).route(model);
  for (const [id, points] of routes) {
    assert.equal(points[0].x, 20, `${id} leaves on the right side`);
    assert.equal(points[points.length - 1].x, 280, `${id} enters on the left side`);
  }
  const e1 = routes.get('e1');
  assert.ok(e1);
  assert.ok(Math.abs(e1[0].y - (offsets[0] - 60)) < 1e-6, 'route starts at the computed port');
});

test('docking ports follow flowDirection and per-edge sides', () => {
  const model: GraphModel = {
    nodes: [
      { id: 's', x: 0, y: 0, width: 60, height: 40 },
      { id: 't', x: 0, y: 200, width: 60, height: 40 },
    ],
    edges: [
      { id: 'down', source: 's', target: 't', width: 4 },
      { id: 'side', source: 's', target: 't', width: 4, sourceSide: 'left', targetSide: 'right' },
    ],
  };
  const ports = computeDockingPorts(model, { flowDirection: 'down' });
  assert.deepEqual(
    [ports.get('down')?.source.side, ports.get('down')?.target.side],
    ['bottom', 'top'],
    'flow direction sides',
  );
  assert.deepEqual([ports.get('side')?.source.side, ports.get('side')?.target.side], ['left', 'right']);

  const routes = new EdgeRouter(avoid, { ports: 'docking', flowDirection: 'down' }).route(model);
  const side = routes.get('side');
  assert.ok(side);
  assert.equal(side[0].x, -30, 'leaves s on the left');
  assert.equal(side[side.length - 1].x, 30, 'enters t on the right');
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
  for (const port of ports.values()) assert.ok(port.source.offset >= 0 && port.source.offset <= 1);
  assert.notEqual(ports.get('a')?.source.offset, ports.get('b')?.source.offset);
});

test('an unknown flowDirection is reported', () => {
  const options = { flowDirection: 'sideways' } as unknown as Partial<RoutingOptions>;
  assert.throws(() => computeDockingPorts(obstacleModel, options), /unknown flowDirection "sideways"/);
});

test('spreadPorts centres the stack and keeps the spacing', () => {
  // widths 10 + 20 with spacing 2 = 32 px, centred on a 100 px side: starts at 34
  assert.deepEqual(spreadPorts([10, 20], 100, 2), [0.39, 0.56]);
  assert.deepEqual(spreadPorts([10], 0, 2), [0.5], 'empty side');
});

test('simplify rounds float noise and drops duplicate and straight-run points', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 0.0000001, y: 0 }, // duplicate after rounding
    { x: 50, y: 0 }, // middle of a straight run
    { x: 100, y: 0 },
    { x: 100, y: 50 },
  ];
  assert.deepEqual(simplify(points), [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
  ]);
  const uTurn = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 50, y: 0 },
  ];
  assert.deepEqual(simplify(uTurn), uTurn, 'a turn back is kept');
});

test('rebuild performance for a mid-sized flow graph', () => {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (let col = 0; col < 8; col++) {
    for (let row = 0; row < 8; row++) {
      nodes.push({ id: `n${col}_${row}`, x: col * 220, y: row * 120, width: 60, height: 50 });
    }
  }
  let k = 0;
  for (let col = 0; col < 7; col++) {
    for (let row = 0; row < 8; row++) {
      const source = `n${col}_${row}`;
      edges.push({ id: `e${k++}`, source, target: `n${col + 1}_${(row * 3 + 1) % 8}`, width: 2 + (k % 10) });
      edges.push({ id: `e${k++}`, source, target: `n${Math.min(7, col + 2)}_${(row + 5) % 8}`, width: 2 + (k % 7) });
    }
  }
  for (const ports of ['auto', 'docking'] as const) {
    const start = performance.now();
    const routes = new EdgeRouter(avoid, { ports }).route({ nodes, edges });
    const ms = performance.now() - start;
    console.log(`  ${ports}: ${nodes.length} nodes, ${routes.size} edges routed in ${ms.toFixed(1)} ms`);
    assert.equal(routes.size, edges.filter((e) => e.source !== e.target).length);
    assert.ok(ms < 2000, `fast enough for live re-routing (${ms.toFixed(0)} ms)`);
  }
});
