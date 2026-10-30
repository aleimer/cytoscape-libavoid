import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EdgeStyler } from '../src/cytoscape-adapter/edge-styler';
import { edgeStyleToPoints, labelOffset, routeToEdgeStyle } from '../src/cytoscape-adapter/route-style';
import { createCy, obstacleElements } from './helpers';

test('route -> cytoscape segment style round trip is exact', () =>
{
  const points = [
    { x: 30, y: -12 },
    { x: 71, y: -12 },
    { x: 71, y: -154 },
    { x: 270, y: -154 },
  ];
  const style = routeToEdgeStyle(points, { x: 0, y: 0 }, { x: 300, y: -150 });
  assert.ok(style);
  assert.equal(style['curve-style'], 'segments');
  assert.equal(style['source-endpoint'], '30px -12px');
  const back = edgeStyleToPoints(style, { x: 0, y: 0 }, { x: 300, y: -150 });
  back.forEach((p, i) =>
  {
    assert.ok(
      Math.abs(p.x - points[i].x) < 0.01 && Math.abs(p.y - points[i].y) < 0.01,
      `point ${i}: ${JSON.stringify(p)}`,
    );
  });
});

test('straight routes still produce a valid segments style', () =>
{
  const straight = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];
  const style = routeToEdgeStyle(straight, { x: -10, y: 0 }, { x: 110, y: 0 }, { cornerRadius: 5 });
  assert.ok(style);
  assert.equal(style['curve-style'], 'round-segments');
  assert.equal(style['segment-weights'], '0.5');
  assert.equal(style['segment-distances'], '0');
});

test('degenerate routes produce no style', () =>
{
  assert.equal(routeToEdgeStyle(undefined, { x: 0, y: 0 }, { x: 0, y: 0 }), null);
  assert.equal(routeToEdgeStyle([{ x: 5, y: 5 }], { x: 0, y: 0 }, { x: 0, y: 0 }), null);
  const zeroLength = [
    { x: 5, y: 5 },
    { x: 5, y: 5 },
  ];
  assert.equal(routeToEdgeStyle(zeroLength, { x: 0, y: 0 }, { x: 0, y: 0 }), null);
});

test('EdgeStyler applies routes, drops rounded corners and restores edges', () =>
{
  const cy = createCy(obstacleElements());
  const styler = new EdgeStyler(cy);
  const edge = cy.$id('ab');
  const route = [
    { x: 20, y: 0 },
    { x: 60, y: 0 },
    { x: 60, y: -50 },
    { x: 280, y: -50 },
    { x: 280, y: 0 },
  ];
  try
  {
    styler.apply(new Map([['ab', route]]), { cornerRadius: 8 });
    assert.equal(edge.style('curve-style'), 'round-segments');

    styler.apply(new Map([['ab', route]]), { cornerRadius: 0 });
    assert.equal(edge.style('curve-style'), 'segments', 'switching back to sharp corners');
    assert.equal(edge.style('radius-type'), 'arc-radius', 'stylesheet default again, not the bypass');

    styler.apply(new Map());
    assert.equal(edge.style('curve-style'), 'taxi', 'edges that are no longer routed are restored');

    styler.apply(new Map([['ab', route]]));
    styler.clear();
    assert.equal(edge.style('curve-style'), 'taxi', 'clear() restores everything');
  }
  finally
  {
    cy.destroy();
  }
});

test('labelOffset moves the label from the middle segment point to the longest horizontal segment', () =>
{
  // inner points: (60,0) (60,-50) (280,-50) -> Cytoscape puts the label on the middle one, (60,-50)
  const route = [
    { x: 20, y: 0 },
    { x: 60, y: 0 },
    { x: 60, y: -50 },
    { x: 280, y: -50 },
    { x: 280, y: 0 },
  ];
  assert.deepEqual(labelOffset(route, route.slice(1, -1)), { x: 170 - 60, y: 0 });
  // an even number of inner points: the middle between the two middle ones
  const even = [
    { x: 0, y: 0 },
    { x: 0, y: 100 },
    { x: 40, y: 100 },
    { x: 40, y: 400 },
  ];
  assert.deepEqual(
    labelOffset(even, even.slice(1, -1)),
    { x: 40 - 20, y: 250 - 100 },
    'the vertical one is much longer',
  );
});

test("labelPosition 'longest-segment' sets the label margin, switching back removes it", () =>
{
  const cy = createCy(obstacleElements());
  const styler = new EdgeStyler(cy);
  const edge = cy.$id('ab');
  const route = [
    { x: 20, y: 0 },
    { x: 60, y: 0 },
    { x: 60, y: -50 },
    { x: 280, y: -50 },
    { x: 280, y: 0 },
  ];
  try
  {
    styler.apply(new Map([['ab', route]]), { labelPosition: 'longest-segment' });
    assert.equal(edge.numericStyle('text-margin-x'), 110);
    styler.apply(new Map([['ab', route]]), { labelPosition: 'middle' });
    assert.equal(edge.numericStyle('text-margin-x'), 0, 'the bypass is gone');
  }
  finally
  {
    cy.destroy();
  }
});
