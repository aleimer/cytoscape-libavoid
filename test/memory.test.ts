import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EdgeRouter, loadLibavoid } from '../src';
import type { GraphModel } from '../src';

/** 6 x 5 nodes, each linked to two nodes of the next column. */
function gridModel(): GraphModel {
  const model: GraphModel = { nodes: [], edges: [] };
  for (let col = 0; col < 6; col++) {
    for (let row = 0; row < 5; row++) {
      model.nodes.push({ id: `n${col}_${row}`, x: col * 200, y: row * 100, width: 60, height: 40 });
    }
  }
  for (let col = 0; col < 5; col++) {
    for (let row = 0; row < 5; row++) {
      for (const next of [row, (row + 2) % 5]) {
        const id = `e${col}_${row}_${next}`;
        model.edges.push({ id, source: `n${col}_${row}`, target: `n${col + 1}_${next}`, width: 4 });
      }
    }
  }
  return model;
}

interface Copy {
  delete(): void;
}

/**
 * embind hands out copies of returned C++ objects, which stay in WebAssembly
 * memory until delete() is called. This wraps ConnRef.displayRoute() to count
 * the route and point copies and whether each one is freed.
 */
function trackRouteCopies(connRefPrototype: { displayRoute(): unknown }): { created: number; freed: number } {
  const counts = { created: 0, freed: 0 };
  const track = <T extends Copy>(copy: T): T => {
    counts.created++;
    const free = copy.delete.bind(copy);
    copy.delete = () => {
      counts.freed++;
      free();
    };
    return copy;
  };
  const displayRoute = connRefPrototype.displayRoute;
  connRefPrototype.displayRoute = function (this: unknown) {
    const route = track(displayRoute.call(this) as Copy & { at(index: number): Copy });
    const at = route.at.bind(route);
    route.at = (index: number) => track(at(index));
    return route;
  };
  return counts;
}

test('every route and point copy libavoid hands out is freed', async () => {
  const avoid = await loadLibavoid();
  const prototype = (avoid.ConnRef as unknown as { prototype: { displayRoute(): unknown } }).prototype;
  const original = prototype.displayRoute;
  const counts = trackRouteCopies(prototype);
  try {
    for (const ports of ['auto', 'docking'] as const) new EdgeRouter(avoid, { ports }).route(gridModel());
    assert.ok(counts.created > 100, `copies were made (${counts.created})`);
    assert.equal(counts.freed, counts.created, 'copies left in WebAssembly memory');
  } finally {
    prototype.displayRoute = original;
  }
});
