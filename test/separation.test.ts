import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { EdgeRouter, loadLibavoid, routeQuality } from '../src';
import { separateOverlaps } from '../src/postprocess/overlap-separator';
import type { Avoid, GraphModel, Point } from '../src';
import { box, segmentHitsRect } from './helpers';
import { COLLAPSIBLE_GROUPS, plantModel, plantView } from '../demo/plant-graph';

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

test('separateOverlaps spreads stacked segments apart and leaves ends alone that do not overlap', () => {
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

test('separateOverlaps slides end segments along the node side they end at', () => {
  // both leave a at the pin in the middle of its right side (x = 20, side from y = -15 to 25)
  const route = [
    { x: 20, y: 5 },
    { x: 150, y: 5 },
    { x: 150, y: 195 },
    { x: 280, y: 195 },
  ];
  const routes = new Map([
    ['e1', route],
    ['e2', route],
  ]);
  const separated = separateOverlaps(routes, twoEdges, 2);
  const [e1, e2] = [separated.get('e1')!, separated.get('e2')!];
  assert.ok(Math.abs(e1[0]!.y - e2[0]!.y) >= 6 + 2 - 1e-9, `fanned out at a: ${e1[0]!.y} / ${e2[0]!.y}`);
  for (const r of [e1, e2]) {
    assert.equal(r[0]!.x, 20, 'starts on the right side of a');
    assert.ok(r[0]!.y - 3 >= -15 && r[0]!.y + 3 <= 25, `stroke at y = ${r[0]!.y} stays on the side`);
    assert.equal(r[3]!.x, 280, 'ends on the left side of b');
    assert.ok(r[3]!.y - 3 >= 175 && r[3]!.y + 3 <= 215, `stroke at y = ${r[3]!.y} stays on the side`);
    assertOrthogonal(r);
  }
  assert.equal(routeQuality(separated, twoEdges).overlap, 0);
});

test('separateOverlaps leaves end segments alone that do not end on a node side', () => {
  // the last point (150, 175) is not on the border of b
  const route = [
    { x: 20, y: 5 },
    { x: 150, y: 5 },
    { x: 150, y: 175 },
  ];
  const routes = new Map([
    ['e1', route],
    ['e2', route],
  ]);
  const separated = separateOverlaps(routes, twoEdges, 2);
  assert.deepEqual([separated.get('e1')![2], separated.get('e2')![2]], [route[2], route[2]]);
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

test('separation and detours reduce overlaps in crowded gaps', () => {
  const model = crowdedModel();
  const plain = new EdgeRouter(avoid, { separateOverlaps: false, detourCrowded: false }).route(model);
  const improved = new EdgeRouter(avoid).route(model);
  const before = routeQuality(plain, model);
  const after = routeQuality(improved, model);
  assert.ok(before.overlap > 0, 'the test graph has overlaps to begin with');
  assert.ok(after.overlap < 0.5 * before.overlap, `overlap ${before.overlap} -> ${after.overlap}`);
  assert.ok(after.crossings < 1.5 * before.crossings + 5, `crossings ${before.crossings} -> ${after.crossings}`);
  for (const route of improved.values()) assertOrthogonal(route);
  assertNoNodeHits(model, improved);
});

test('steel plant: crowded gaps between nodes one grid step apart', () => {
  const model = plantModel();
  const plain = new EdgeRouter(avoid, { separateOverlaps: false, detourCrowded: false }).route(model);
  const improved = new EdgeRouter(avoid).route(model);
  assert.equal(improved.size, model.edges.length, 'every flow is routed');
  const before = routeQuality(plain, model);
  const after = routeQuality(improved, model);
  // libavoid alone stacks ~70,000 px, a few short segments in the narrowest gaps remain
  assert.ok(after.overlap < 0.01 * before.overlap, `overlap ${before.overlap} -> ${after.overlap}`);
  for (const route of improved.values()) assertOrthogonal(route);
  assertNoNodeHits(model, improved);
});

test('steel plant with collapsed groups: edges end at the groups and avoid every node', () => {
  const collapsed = new Set(COLLAPSIBLE_GROUPS);
  const model = plantModel({}, collapsed);
  const ids = new Set(model.nodes.map((node) => node.id));
  for (const group of collapsed) assert.ok(ids.has(group), `${group} is a node`);
  assert.ok(!ids.has('HoA'), 'members of collapsed groups are gone');
  assert.ok(
    model.edges.some((edge) => edge.source === 'Ho-ABC' && edge.target === 'RE-123'),
    'edges between members end at their groups',
  );
  const routes = new EdgeRouter(avoid).route(model);
  assert.equal(routes.size, model.edges.length);
  assertNoNodeHits(model, routes);
});

test('plantView: only groups with a parent collapse; nested members follow the outermost one', () => {
  const view = plantView(new Set(['TS', 'SGA-1234']));
  assert.ok(
    view.groups.some((group) => group.id === 'TS'),
    'a visual group stays expanded',
  );
  assert.ok(view.nodes.some((node) => node.id === 'SGA-1234' && node.collapsed && node.parent === 'TS'));
  assert.ok(!view.nodes.some((node) => node.id === 'SGA1'));
  assert.ok(view.edges.every((edge) => edge.source !== edge.target));
});

test('steel plant: edges into the same node side fan out along it', () => {
  const model = plantModel();
  const routes = new EdgeRouter(avoid).route(model);
  const ends = ['VSH-V4->CUST', 'VSH-U1->CUST', 'OV-Y->CUST'].map((id) => routes.get(id)!.at(-1)!);
  assert.equal(new Set(ends.map((end) => end.y)).size, 3, `ends: ${JSON.stringify(ends)}`);
});

/**
 * A hub with edges to nodes above, beside and below it, all attached to its right
 * side; `into[i]` makes edge i end at the hub instead of starting there.
 */
function hubModel(widths: number[], into: boolean[] = []): GraphModel {
  const ys = [-150, 0, 150, 300].slice(0, widths.length);
  return {
    nodes: [
      { id: 'hub', x: 0, y: 0, width: 80, height: 120 },
      ...ys.map((y, i) => ({ id: `t${i}`, x: 300, y, width: 60, height: 40 })),
    ],
    edges: widths.map((width, i) =>
      into[i]
        ? { id: `e${i}`, source: `t${i}`, target: 'hub', width, targetSides: ['right'] }
        : { id: `e${i}`, source: 'hub', target: `t${i}`, width, sourceSides: ['right'] },
    ),
  };
}

/** Where each edge of a hubModel() attaches to the hub. */
const hubEnds = (model: GraphModel, routes: ReadonlyMap<string, readonly Point[]>): Map<string, Point> =>
  new Map(
    model.edges.map((edge) => {
      const route = routes.get(edge.id)!;
      return [edge.id, edge.source === 'hub' ? route[0]! : route.at(-1)!];
    }),
  );

test('the thickest of three or more edges on a node side attaches at its centre, starting or ending there', () => {
  for (const [widths, into] of [
    [[8, 2, 3], []],
    [[2, 3, 5, 8], []],
    [
      [8, 2, 3],
      [true, true, true],
    ],
    [
      [2, 8, 3, 5],
      [true, false, true, false],
    ],
  ] as Array<[number[], boolean[]]>) {
    const label = `widths ${widths.join(', ')}, into ${into.join(', ')}`;
    const model = hubModel(widths, into);
    const routes = new EdgeRouter(avoid).route(model);
    const ends = hubEnds(model, routes);
    const thickest = model.edges.reduce((a, b) => (b.width! > a.width! ? b : a));
    assert.equal(ends.get(thickest.id)!.y, 0, label);
    const ys = [...ends.values()].map((end) => end.y);
    assert.equal(new Set(ys).size, ys.length, `${label}: ends stay apart: ${ys.join(', ')}`);
    for (const route of routes.values()) assertOrthogonal(route);
    assertNoNodeHits(model, routes);
  }
});

test("two edges on a node side keep libavoid's fan", () => {
  const model = hubModel([8, 2]);
  const routes = new EdgeRouter(avoid).route(model);
  assert.notEqual(hubEnds(model, routes).get('e0')!.y, 0);
});
