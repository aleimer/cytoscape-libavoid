import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import cytoscape from 'cytoscape';
import register, { loadLibavoid } from '../src';
import type { Avoid, RoutingOptions } from '../src';
import { countRoutes, createCy, obstacleElements, setGrabbed, wait } from './helpers';

let avoid: Avoid;
before(async () => {
  avoid = await loadLibavoid();
  register(cytoscape);
});

test('cy.libavoid() styles edges, re-routes on move and restores on destroy', async () => {
  const cy = createCy(obstacleElements());
  const routes = countRoutes(cy);
  const routing = cy.libavoid({ avoidLib: avoid });
  try {
    await routing.ready;
    assert.equal(cy.libavoid(), routing, 'no-arg call returns the instance');

    const edge = cy.$id('ab');
    assert.equal(edge.style('curve-style'), 'segments');
    assert.ok((routing.getRoute('ab')?.length ?? 0) >= 4, 'routed around c');

    cy.$id('c').position({ x: 150, y: 300 }); // move the obstacle out of the way
    await wait(20);
    assert.equal(routing.getRoute(edge)?.length, 2, 'straight after the obstacle moved');
    assert.ok(routes.count >= 2);

    routing.destroy();
    assert.equal(edge.style('curve-style'), 'taxi', 'original stylesheet restored');
    assert.equal(cy.scratch('_libavoid'), undefined);
  } finally {
    cy.destroy();
  }
});

test('cy.libavoid(options) replaces the previous instance', async () => {
  const cy = createCy(obstacleElements());
  try {
    const first = cy.libavoid({ avoidLib: avoid });
    await first.ready;
    const second = cy.libavoid({ avoidLib: avoid, cornerRadius: 5 });
    await second.ready;
    assert.notEqual(first, second);
    assert.equal(cy.libavoid(), second);
    assert.equal(cy.$id('ab').style('curve-style'), 'round-segments');
  } finally {
    cy.destroy();
  }
});

test('live routing settles with compound nodes and ignores changes that move nothing', async () => {
  // with compounds, setting edge styles fires 'style' on all nodes, which used to re-route forever
  const cy = createCy([
    { data: { id: 'g1' } },
    { data: { id: 'g2' } },
    { data: { id: 'a', parent: 'g1' }, position: { x: 0, y: 0 } },
    { data: { id: 'b', parent: 'g2' }, position: { x: 300, y: 0 } },
    { data: { id: 'c' }, position: { x: 150, y: 0 } },
    { data: { id: 'ab', source: 'a', target: 'b' } },
  ]);
  const routes = countRoutes(cy);
  const routing = cy.libavoid({ avoidLib: avoid });
  try {
    await routing.ready;
    await wait(60);
    assert.equal(routes.count, 1, 'no re-routes after the initial one');

    cy.$id('a').data('value', 42); // live data, same geometry
    await wait(30);
    assert.equal(routes.count, 1, 'data change without geometry change does not re-route');

    cy.$id('c').position({ x: 150, y: 300 });
    await wait(30);
    assert.equal(routes.count, 2, 'moving an obstacle re-routes once');
    assert.equal(routing.getRoute('ab')?.length, 2);

    // rerouteOnDrag: false must also hold back re-routes from the style events a drag fires in compound graphs
    routing.setOptions({ rerouteOnDrag: false });
    routes.reset();
    const a = cy.$id('a');
    setGrabbed(a, true);
    a.position({ x: 0, y: 100 });
    a.addClass('dragging');
    await wait(30);
    assert.equal(routes.count, 0, 'no re-route while a node is grabbed');
    setGrabbed(a, false);
    a.emit('free');
    await wait(30);
    assert.equal(routes.count, 1, 're-routes on release');
  } finally {
    cy.destroy(); // also stops a runaway re-route loop, so a regression fails instead of hanging
  }
});

test('dragRouteInterval spaces out re-routes while dragging and routes the final position on release', async () => {
  const cy = createCy(obstacleElements());
  const routes = countRoutes(cy);
  const routing = cy.libavoid({ avoidLib: avoid, dragRouteInterval: 300 });
  try {
    await routing.ready;
    routes.reset();
    const c = cy.$id('c');
    setGrabbed(c, true);
    for (let y = 10; y <= 100; y += 10) {
      c.position({ x: 150, y });
      await wait(10);
    }
    assert.equal(routes.count, 0, 'no re-route within the interval');

    c.position({ x: 150, y: 300 }); // out of the way
    setGrabbed(c, false);
    c.emit('free');
    await wait(400);
    assert.equal(routes.count, 1, 'one re-route after the interval');
    assert.equal(routing.getRoute('ab')?.length, 2, 'routed with the final position');
  } finally {
    cy.destroy();
  }
});

test('a failing re-route emits avoiderror and the plugin keeps running', async () => {
  const cy = createCy(obstacleElements());
  const routing = cy.libavoid({ avoidLib: avoid });
  const errors: unknown[] = [];
  cy.on('avoiderror', (_evt, error) => errors.push(error));
  const consoleError = console.error;
  console.error = () => {}; // the plugin also logs the error
  try {
    await routing.ready;
    Object.assign(routing.options.routingParameters, { bogus: 1 });
    cy.$id('c').position({ x: 150, y: 20 });
    await wait(30);
    cy.$id('a').data('value', 1); // same geometry: the failed input is not retried
    await wait(30);
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]), /unknown routing parameter "bogus"/);

    delete (routing.options.routingParameters as Record<string, number>)['bogus'];
    cy.$id('c').position({ x: 150, y: 300 });
    await wait(30);
    assert.equal(routing.getRoute('ab')?.length, 2, 'routes again once the input is valid');
  } finally {
    console.error = consoleError;
    cy.destroy();
  }
});

test('setOptions reports invalid options to the caller', async () => {
  const cy = createCy(obstacleElements());
  const routing = cy.libavoid({ avoidLib: avoid });
  try {
    await routing.ready;
    const bad = { routingOptions: { bogus: true } } as unknown as Partial<RoutingOptions>;
    assert.throws(() => routing.setOptions(bad), /unknown routing option "bogus"/);
  } finally {
    cy.destroy();
  }
});

test('destroy() before libavoid is ready leaves the edges untouched', async () => {
  const cy = createCy(obstacleElements());
  const routes = countRoutes(cy);
  const routing = cy.libavoid({ avoidLib: avoid });
  routing.destroy();
  try {
    await routing.ready;
    assert.equal(routes.count, 0);
    assert.equal(cy.$id('ab').style('curve-style'), 'taxi');
  } finally {
    cy.destroy();
  }
});

test('live: false routes only on request, switching it on starts listening', async () => {
  const cy = createCy(obstacleElements());
  const routes = countRoutes(cy);
  const routing = cy.libavoid({ avoidLib: avoid, live: false });
  try {
    await routing.ready;
    assert.equal(routes.count, 1, 'the first run still happens');

    cy.$id('c').position({ x: 150, y: 300 });
    await wait(30);
    assert.equal(routes.count, 1, 'no automatic re-route');
    routing.route();
    assert.equal(routing.getRoute('ab')?.length, 2, 'manual route() picks up the change');

    routing.setOptions({ live: true });
    routes.reset();
    cy.$id('c').position({ x: 150, y: 0 });
    await wait(30);
    assert.equal(routes.count, 1, 're-routes automatically again');
    assert.ok((routing.getRoute('ab')?.length ?? 0) >= 4);
  } finally {
    cy.destroy();
  }
});
