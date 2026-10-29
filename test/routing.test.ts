import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { EdgeRouter, loadLibavoid } from '../src';
import { simplify } from '../src/postprocess/simplify';
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

test('routes start and end on the node border', () => {
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

test('an endpoint-only node: its edges end on the side facing the other end, other edges cross it', () => {
  const group: GraphNode = { id: 'group', x: 0, y: 100, width: 120, height: 80, obstacle: false };
  const model: GraphModel = {
    nodes: [...obstacleModel.nodes, group, { id: 'c', x: 0, y: 400, width: 40, height: 40 }],
    edges: [
      { id: 'group-b', source: 'group', target: 'b' },
      { id: 'a-c', source: 'a', target: 'c' }, // straight down through the group
    ],
  };
  const routes = new EdgeRouter(avoid).route(model);
  const groupB = routes.get('group-b');
  assert.ok(groupB, 'routed');
  assert.deepEqual(groupB[0], { x: 60, y: 100 }, 'starts in the middle of the right side');
  for (let i = 1; i < groupB.length; i++) {
    assert.ok(!segmentHitsRect(groupB[i - 1], groupB[i], box(obstacleModel.nodes[2])), 'still avoids obstacles');
  }
  assert.equal(routes.get('a-c')?.length, 2, 'not an obstacle for other edges');
});

test('sourceSides / targetSides restrict the sides an edge ends at', () => {
  const model: GraphModel = {
    nodes: obstacleModel.nodes,
    edges: [{ id: 'ab', source: 'a', target: 'b', sourceSides: ['bottom'], targetSides: ['top', 'bottom'] }],
  };
  const points = new EdgeRouter(avoid).route(model).get('ab');
  assert.ok(points);
  assert.equal(points[0].y, 20, 'leaves a at the bottom');
  assert.equal(points[1].x, points[0].x, 'heading down');
  assert.ok([-20, 20].includes(points[points.length - 1].y), 'ends at the top or bottom of b');
});

test('loadLibavoid() with another URL after the first load warns and reuses the instance', async () => {
  const warnings: string[] = [];
  const consoleWarn = console.warn;
  console.warn = (message: string) => warnings.push(message);
  try {
    assert.equal(await loadLibavoid(), avoid);
    assert.equal(warnings.length, 0, 'no URL: no warning');
    assert.equal(await loadLibavoid('elsewhere/libavoid.wasm'), avoid);
    assert.match(warnings[0] ?? '', /already loaded from the default URL, ignoring elsewhere\/libavoid\.wasm/);
  } finally {
    console.warn = consoleWarn;
  }
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

test('options are checked on creation and frozen', () => {
  const router = new EdgeRouter(avoid, { routingParameters: { crossingPenalty: 1 } });
  assert.ok(Object.isFrozen(router.options) && Object.isFrozen(router.options.routingParameters));
  assert.equal(new EdgeRouter(avoid).options.routingParameters.crossingPenalty, undefined, 'not shared');
  assert.throws(() => new EdgeRouter(avoid, { edgeSpacing: -1 }), /edgeSpacing must be a number >= 0/);
  const bogus = { routingParameters: { bogus: 1 } } as unknown as Partial<RoutingOptions>;
  assert.throws(() => new EdgeRouter(avoid, bogus), /unknown routing parameter "bogus"/);
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
  const start = performance.now();
  const routes = new EdgeRouter(avoid).route({ nodes, edges });
  const ms = performance.now() - start;
  console.log(`  ${nodes.length} nodes, ${routes.size} edges routed in ${ms.toFixed(1)} ms`);
  assert.equal(routes.size, edges.filter((e) => e.source !== e.target).length);
  assert.ok(ms < 2000, `fast enough for live re-routing (${ms.toFixed(0)} ms)`);
});
