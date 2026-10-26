import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { EdgeRouter, loadLibavoid, routeQuality, separateOverlaps } from '../src';
import type { Avoid, GraphModel, Point } from '../src';
import { box, segmentHitsRect } from './helpers';

let avoid: Avoid;
before(async () => {
  avoid = await loadLibavoid();
});

const segmentsOf = (route: readonly Point[]): Array<[Point, Point]> =>
  route.slice(1).map((point, i) => [route[i]!, point]);

function assertOrthogonal(route: readonly Point[]): void {
  for (const [a, b] of segmentsOf(route))
    assert.ok(a.x === b.x || a.y === b.y, `not orthogonal: ${JSON.stringify(route)}`);
}

function assertNoNodeHits(model: GraphModel, routes: ReadonlyMap<string, readonly Point[]>): void {
  for (const edge of model.edges) {
    for (const [a, b] of segmentsOf(routes.get(edge.id) ?? [])) {
      for (const node of model.nodes) {
        if (node.id === edge.source || node.id === edge.target) continue;
        assert.ok(!segmentHitsRect(a, b, box(node, -0.5)), `${edge.id} runs through ${node.id}`);
      }
    }
  }
}

const twoEdges: GraphModel = {
  nodes: [
    { id: 'a', x: 0, y: 5, width: 40, height: 40 },
    { id: 'b', x: 300, y: 195, width: 40, height: 40 },
  ],
  edges: [
    { id: 'e1', source: 'a', target: 'b', width: 6 },
    { id: 'e2', source: 'a', target: 'b', width: 6 },
  ],
};

test('separateOverlaps spreads stacked segments apart and keeps the ends at their ports', () => {
  const routes = new Map([
    [
      'e1',
      [
        { x: 20, y: 0 },
        { x: 150, y: 0 },
        { x: 150, y: 200 },
        { x: 280, y: 200 },
      ],
    ],
    [
      'e2',
      [
        { x: 20, y: 10 },
        { x: 150, y: 10 },
        { x: 150, y: 190 },
        { x: 280, y: 190 },
      ],
    ],
  ]);
  const separated = separateOverlaps(routes, twoEdges, 2);
  const [e1, e2] = [separated.get('e1')!, separated.get('e2')!];
  assert.ok(Math.abs(e1[1]!.x - e2[1]!.x) >= 6 + 2 - 1e-9, 'strokes plus spacing apart');
  assert.deepEqual(
    [e1[0], e1[3], e2[0], e2[3]],
    [routes.get('e1')![0], routes.get('e1')![3], routes.get('e2')![0], routes.get('e2')![3]],
  );
  assertOrthogonal(e1);
  assertOrthogonal(e2);
  assert.equal(routeQuality(separated, twoEdges).overlap, 0);
  assert.equal(routes.get('e1')![1]!.x, 150, 'the input is not changed');
});

test('separateOverlaps squeezes into a narrow gap without entering the nodes beside it', () => {
  const model: GraphModel = {
    nodes: [
      ...twoEdges.nodes,
      { id: 'left', x: 130, y: 100, width: 20, height: 60 }, // border at 140
      { id: 'right', x: 170, y: 100, width: 20, height: 60 }, // border at 160
    ],
    edges: [...twoEdges.edges, { id: 'e3', source: 'a', target: 'b', width: 6 }],
  };
  const routes = new Map(
    ['e1', 'e2', 'e3'].map((id, i) => [
      id,
      [
        { x: 20, y: i * 5 },
        { x: 150, y: i * 5 },
        { x: 150, y: 200 - i * 5 },
        { x: 280, y: 200 - i * 5 },
      ],
    ]),
  );
  const separated = separateOverlaps(routes, model, 2);
  const xs = ['e1', 'e2', 'e3'].map((id) => separated.get(id)![1]!.x);
  assert.equal(new Set(xs).size, 3, `spread: ${xs}`);
  for (const x of xs) assert.ok(x - 3 >= 140 && x + 3 <= 160, `stroke at ${x} stays between the nodes`);
  assertNoNodeHits(model, separated);
});

test('separateOverlaps leaves routes without inner segments alone', () => {
  const routes = new Map([
    [
      'e1',
      [
        { x: 20, y: 0 },
        { x: 150, y: 0 },
        { x: 150, y: 175 },
      ],
    ],
    [
      'e2',
      [
        { x: 20, y: 0 },
        { x: 150, y: 0 },
        { x: 150, y: 175 },
      ],
    ],
  ]);
  assert.deepEqual(separateOverlaps(routes, twoEdges, 2), routes);
});

/**
 * Two stages of 2 x 2 groups stacked with aligned columns: the narrow gaps
 * between the columns form a street through the whole stage, which libavoid
 * fills with far more edges than fit (like the Angular bench graph).
 */
function crowdedModel(): GraphModel {
  const model: GraphModel = { nodes: [], edges: [] };
  const stages: string[][] = [[], []];
  for (let stage = 0; stage < 2; stage++) {
    for (let group = 0; group < 3; group++) {
      for (let i = 0; i < 4; i++) {
        const id = `n${stage}_${group}_${i}`;
        const x = stage * 520 + (i % 2) * 160 + 60;
        const y = group * 248 + Math.floor(i / 2) * 104 + 32;
        model.nodes.push({ id, x, y, width: 120, height: 64 });
        stages[stage]!.push(id);
      }
    }
  }
  stages[0]!.forEach((source, i) => {
    for (const offset of [5, 7]) {
      const target = stages[1]![(i + offset) % 12]!;
      model.edges.push({ id: `${source}-${target}`, source, target, width: 4 + (i % 5) });
    }
  });
  return model;
}

for (const ports of ['auto', 'docking'] as const) {
  test(`separation and detours reduce overlaps in crowded gaps (${ports} ports)`, () => {
    const model = crowdedModel();
    const plain = new EdgeRouter(avoid, { ports, separateOverlaps: false, detourCrowded: false }).route(model);
    const improved = new EdgeRouter(avoid, { ports }).route(model);
    const before = routeQuality(plain, model);
    const after = routeQuality(improved, model);
    assert.ok(before.overlap > 0, 'the test graph has overlaps to begin with');
    assert.ok(after.overlap < 0.5 * before.overlap, `overlap ${before.overlap} -> ${after.overlap}`);
    assert.ok(after.crossings < 1.5 * before.crossings + 5, `crossings ${before.crossings} -> ${after.crossings}`);
    for (const route of improved.values()) assertOrthogonal(route);
    assertNoNodeHits(model, improved);
  });
}

test('polyline routes are not post-processed', () => {
  const model = crowdedModel();
  const routes = new EdgeRouter(avoid, { routingType: 'polyline' }).route(model);
  const plain = new EdgeRouter(avoid, { routingType: 'polyline', separateOverlaps: false, detourCrowded: false }).route(
    model,
  );
  assert.deepEqual(routes, plain);
});
