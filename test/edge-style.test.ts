import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeStyleToPoints, EdgeStyler, routeToEdgeStyle } from '../src';
import { createCy, obstacleElements } from './helpers';

test('route -> cytoscape segment style round trip is exact', () => {
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
  back.forEach((p, i) => {
    assert.ok(
      Math.abs(p.x - points[i].x) < 0.01 && Math.abs(p.y - points[i].y) < 0.01,
      `point ${i}: ${JSON.stringify(p)}`,
    );
  });
});

test('straight routes still produce a valid segments style', () => {
  const straight = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];
  const style = routeToEdgeStyle(straight, { x: -10, y: 0 }, { x: 110, y: 0 }, 5);
  assert.ok(style);
  assert.equal(style['curve-style'], 'round-segments');
  assert.equal(style['segment-weights'], '0.5');
  assert.equal(style['segment-distances'], '0');
});

test('degenerate routes produce no style', () => {
  assert.equal(routeToEdgeStyle(undefined, { x: 0, y: 0 }, { x: 0, y: 0 }), null);
  assert.equal(routeToEdgeStyle([{ x: 5, y: 5 }], { x: 0, y: 0 }, { x: 0, y: 0 }), null);
  const zeroLength = [
    { x: 5, y: 5 },
    { x: 5, y: 5 },
  ];
  assert.equal(routeToEdgeStyle(zeroLength, { x: 0, y: 0 }, { x: 0, y: 0 }), null);
});

test('EdgeStyler applies routes, drops rounded corners and restores edges', () => {
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
  try {
    styler.apply(new Map([['ab', route]]), 8);
    assert.equal(edge.style('curve-style'), 'round-segments');

    styler.apply(new Map([['ab', route]]), 0);
    assert.equal(edge.style('curve-style'), 'segments', 'switching back to sharp corners');
    assert.equal(edge.style('radius-type'), 'arc-radius', 'stylesheet default again, not the bypass');

    styler.apply(new Map(), 0);
    assert.equal(edge.style('curve-style'), 'taxi', 'edges that are no longer routed are restored');

    styler.apply(new Map([['ab', route]]), 0);
    styler.clear();
    assert.equal(edge.style('curve-style'), 'taxi', 'clear() restores everything');
  } finally {
    cy.destroy();
  }
});
