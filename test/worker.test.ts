import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import cytoscape from 'cytoscape';
import register, { defaultRoutingOptions, WorkerRouter } from '../src';
import type { GraphModel } from '../src';
import { countRoutes, createCy, InProcessWorker, obstacleElements, wait } from './helpers';

before(() => register(cytoscape));

test('with a worker, routes are computed there and applied to the edges', async () => {
  const cy = createCy(obstacleElements());
  const worker = new InProcessWorker();
  const routing = cy.libavoid({ worker, ports: 'docking', cornerRadius: 4 });
  try {
    await routing.ready;
    assert.equal(worker.requests.length, 1);
    assert.equal(worker.requests[0].options.ports, 'docking', 'routing options are sent along');
    assert.equal(cy.$id('ab').style('curve-style'), 'round-segments');
    assert.ok((routing.getRoute('ab')?.length ?? 0) >= 4, 'routed around c');
    assert.throws(() => routing.route(), /not available with a worker, use refresh\(\)/);

    cy.$id('c').position({ x: 150, y: 300 });
    await wait(40);
    assert.equal(routing.getRoute('ab')?.length, 2, 'live re-route through the worker');
  } finally {
    cy.destroy();
  }
});

test('with a worker, changes during a request are sent once it is answered', async () => {
  const cy = createCy(obstacleElements());
  const worker = new InProcessWorker();
  const routing = cy.libavoid({ worker });
  const routes = countRoutes(cy);
  try {
    await routing.ready;
    worker.delayMs = 60;
    const c = cy.$id('c');
    for (const y of [20, 40, 60, 80, 300]) {
      c.position({ x: 150, y });
      await wait(10);
    }
    await wait(250);
    assert.equal(worker.requests.length, 3, 'initial, first move, then the latest state');
    assert.equal(worker.requests[2].model.nodes.find((node) => node.id === 'c')?.y, 300);
    assert.equal(routing.getRoute('ab')?.length, 2, 'ends with the final position');
    assert.equal(routes.count, 3);
  } finally {
    cy.destroy();
  }
});

test('with a worker, refresh() waits for a fresh result and errors reject it', async () => {
  const cy = createCy(obstacleElements());
  const worker = new InProcessWorker();
  const routing = cy.libavoid({ worker });
  const errors: unknown[] = [];
  cy.on('avoiderror', (_evt, error) => errors.push(error));
  const consoleError = console.error;
  console.error = () => {};
  try {
    await routing.ready;
    const [first, second] = await Promise.all([routing.refresh(), routing.refresh()]);
    assert.equal(first.get('ab')?.length, second.get('ab')?.length);
    assert.equal(worker.requests.length, 3, 'the second caller asked during the first request');

    Object.assign(routing.options.routingParameters, { bogus: 1 });
    await assert.rejects(routing.refresh(), /unknown routing parameter "bogus"/);
    assert.equal(errors.length, 0, 'a caller that waits gets the error itself');

    cy.$id('c').position({ x: 150, y: 50 });
    await wait(40);
    assert.equal(errors.length, 1, 'automatic runs report errors as avoiderror');
  } finally {
    console.error = consoleError;
    cy.destroy();
  }
});

test('with a worker, a failing first run rejects ready', async () => {
  const cy = createCy(obstacleElements());
  const routing = cy.libavoid({ worker: new InProcessWorker(), routingOptions: { bogus: true } as never });
  try {
    await assert.rejects(routing.ready, /unknown routing option "bogus"/);
  } finally {
    cy.destroy();
  }
});

test('destroy() while a worker request is in flight ignores its answer', async () => {
  const cy = createCy(obstacleElements());
  const worker = new InProcessWorker();
  worker.delayMs = 30;
  const routing = cy.libavoid({ worker });
  const routes = countRoutes(cy);
  routing.destroy();
  try {
    await routing.ready;
    await wait(60);
    assert.equal(routes.count, 0);
    assert.equal(cy.$id('ab').style('curve-style'), 'taxi');
  } finally {
    cy.destroy();
  }
});

test('a late worker answer keeps the edge ends on nodes that moved meanwhile', async () => {
  const cy = createCy(obstacleElements());
  const worker = new InProcessWorker();
  const routing = cy.libavoid({ worker });
  try {
    await routing.ready;
    worker.delayMs = 60;
    const refreshed = routing.refresh(); // sent with a at (0, 0)
    cy.$id('a').position({ x: 0, y: 50 }); // moves while the request is in flight
    await refreshed;
    const start = routing.getRoute('ab')?.[0];
    assert.ok(start);
    // relative to a's position at request time, so Cytoscape draws the end at a's new position
    assert.equal(cy.$id('ab').style('source-endpoint'), `${start.x}px ${start.y}px`);
  } finally {
    cy.destroy();
  }
});

test('edges removed while a worker request is in flight are skipped', async () => {
  const cy = createCy([
    ...obstacleElements(),
    { data: { id: 'd' }, position: { x: 300, y: 200 } },
    { data: { id: 'ad', source: 'a', target: 'd' } },
  ]);
  const worker = new InProcessWorker();
  const routing = cy.libavoid({ worker });
  try {
    await routing.ready;
    worker.delayMs = 30;
    const refreshed = routing.refresh();
    cy.$id('ad').remove();
    await refreshed; // must not throw on the missing edge
    await wait(80);
    assert.equal(routing.getRoute('ad'), undefined);
    assert.equal(cy.$id('ab').style('curve-style'), 'segments');
  } finally {
    cy.destroy();
  }
});

test('setOptions during a worker request is routed afterwards', async () => {
  const cy = createCy(obstacleElements());
  const worker = new InProcessWorker();
  const routing = cy.libavoid({ worker, ports: 'auto' });
  try {
    await routing.ready;
    worker.delayMs = 40;
    cy.$id('c').position({ x: 150, y: 10 }); // starts a request
    await wait(10);
    routing.setOptions({ ports: 'docking' }); // while it is in flight
    await wait(150);
    assert.equal(worker.requests.at(-1)?.options.ports, 'docking');
  } finally {
    cy.destroy();
  }
});

test('WorkerRouters sharing one worker get their own answers; dispose() rejects pending requests', async () => {
  const worker = new InProcessWorker();
  const model = (x: number): GraphModel => ({
    nodes: [
      { id: 'a', x: 0, y: 0, width: 40, height: 40 },
      { id: 'b', x, y: 0, width: 40, height: 40 },
    ],
    edges: [{ id: 'ab', source: 'a', target: 'b' }],
  });
  const first = new WorkerRouter(worker);
  const second = new WorkerRouter(worker);
  const [near, far] = await Promise.all([
    first.route({ model: model(100), options: defaultRoutingOptions }),
    second.route({ model: model(500), options: defaultRoutingOptions }),
  ]);
  assert.equal(near.routes.get('ab')?.at(-1)?.x, 80);
  assert.equal(far.routes.get('ab')?.at(-1)?.x, 480);
  assert.equal(first.busy || second.busy, false);

  const pending = first.route({ model: model(100), options: defaultRoutingOptions });
  assert.equal(first.busy, true);
  first.dispose();
  await assert.rejects(pending, /disposed/);
  second.dispose();
});
