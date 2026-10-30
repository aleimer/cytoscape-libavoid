import cytoscape from 'cytoscape';
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import register, { loadLibavoid } from '../src';
import type { Avoid, RoutingOptions } from '../src';
import { countRoutes, createCy, obstacleElements, setGrabbed, wait } from './helpers';

let avoid: Avoid;
before(async () =>
{
  avoid = await loadLibavoid();
  register(cytoscape);
});

test('cy.libavoid() styles edges, re-routes on move and restores on destroy', async () =>
{
  const cy = createCy(obstacleElements());
  const routes = countRoutes(cy);
  const routing = cy.libavoid({ avoidLib: avoid });
  try
  {
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
  }
  finally
  {
    cy.destroy();
  }
});

test('cy.libavoid(options) replaces the previous instance', async () =>
{
  const cy = createCy(obstacleElements());
  try
  {
    const first = cy.libavoid({ avoidLib: avoid });
    await first.ready;
    const second = cy.libavoid({ avoidLib: avoid, cornerRadius: 5 });
    await second.ready;
    assert.notEqual(first, second);
    assert.equal(cy.libavoid(), second);
    assert.equal(cy.$id('ab').style('curve-style'), 'round-segments');
  }
  finally
  {
    cy.destroy();
  }
});

test('live routing settles with compound nodes and ignores changes that move nothing', async () =>
{
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
  try
  {
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
    await wait(30); // setOptions() routes too
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
  }
  finally
  {
    cy.destroy(); // also stops a runaway re-route loop, so a regression fails instead of hanging
  }
});

test('edges to compound nodes are routed from their border, edges into their own children are not', async () =>
{
  const cy = createCy([
    { data: { id: 'g' } },
    { data: { id: 'x', parent: 'g' }, position: { x: 0, y: 0 } },
    ...obstacleElements().filter((element) => element.data.id !== 'a' && element.data.id !== 'ab'),
    { data: { id: 'gb', source: 'g', target: 'b' } },
    { data: { id: 'xg', source: 'x', target: 'g' } },
  ]);
  const routing = cy.libavoid({ avoidLib: avoid });
  try
  {
    await routing.ready;
    const route = routing.getRoute('gb');
    assert.ok(route && route.length >= 4, 'routed around c');
    assert.equal(route[0]!.x, cy.$id('g').boundingBox({ includeLabels: false }).x2, 'starts on the right side of g');
    assert.equal(cy.$id('gb').style('curve-style'), 'segments');
    assert.equal(routing.getRoute('xg'), undefined, 'child to its own parent is left alone');
    assert.equal(cy.$id('xg').style('curve-style'), 'taxi');
  }
  finally
  {
    cy.destroy();
  }
});

test('edgeSides restricts the sides, and a change is picked up', async () =>
{
  const cy = createCy(obstacleElements());
  let side: 'top' | 'bottom' = 'top';
  const routing = cy.libavoid({ avoidLib: avoid, edgeSides: () => ({ source: side, target: [side] }) });
  try
  {
    await routing.ready;
    const { y1, y2 } = cy.$id('a').boundingBox({ includeLabels: false });
    assert.equal(routing.getRoute('ab')?.[0]?.y, y1, 'leaves a at the top');
    side = 'bottom';
    cy.$id('a').data('flip', true); // any change re-reads the option
    await wait(30);
    const route = routing.getRoute('ab')!;
    assert.equal(route[0]!.y, y2, 'now at the bottom');
    assert.equal(route[route.length - 1]!.y, y2);
  }
  finally
  {
    cy.destroy();
  }
});

test('dragRouteInterval spaces out re-routes while dragging and routes the final position on release', async () =>
{
  const cy = createCy(obstacleElements());
  const routes = countRoutes(cy);
  const routing = cy.libavoid({ avoidLib: avoid, dragRouteInterval: 300 });
  try
  {
    await routing.ready;
    routes.reset();
    const c = cy.$id('c');
    setGrabbed(c, true);
    for (let y = 10; y <= 100; y += 10)
    {
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
  }
  finally
  {
    cy.destroy();
  }
});

test('dragRouteDelay routes only once the dragged node rests', async () =>
{
  const cy = createCy(obstacleElements());
  const routes = countRoutes(cy);
  const routing = cy.libavoid({ avoidLib: avoid, dragRouteDelay: 100 });
  try
  {
    await routing.ready;
    routes.reset();
    const c = cy.$id('c');
    setGrabbed(c, true);
    for (let y = 10; y <= 300; y += 10)
    {
      c.position({ x: 150, y });
      await wait(10);
    }
    assert.equal(routes.count, 0, 'no re-route while the node moves');
    await wait(150);
    assert.equal(routes.count, 1, 'one re-route once it rests');
    assert.equal(routing.getRoute('ab')?.length, 2, 'routed with the resting position');

    c.position({ x: 150, y: 0 });
    setGrabbed(c, false);
    c.emit('free');
    await wait(30);
    assert.equal(routes.count, 2, 'the release routes at once');
    assert.ok((routing.getRoute('ab')?.length ?? 0) >= 4);
  }
  finally
  {
    cy.destroy();
  }
});

test('hideEdgesOnDrag hides the edges of a dragged node until they are routed again', async () =>
{
  const cy = createCy([
    ...obstacleElements(),
    { data: { id: 'd' }, position: { x: 0, y: 200 } },
    { data: { id: 'cd', source: 'c', target: 'd' } },
  ]);
  const routing = cy.libavoid({ avoidLib: avoid, hideEdgesOnDrag: true, dragRouteDelay: 100 });
  const opacity = (id: string) => Number(cy.$id(id).style('line-opacity'));
  try
  {
    await routing.ready;
    const a = cy.$id('a');
    setGrabbed(a, true);
    a.position({ x: 0, y: 20 });
    assert.equal(opacity('ab'), 0, 'the edge of the dragged node is hidden');
    assert.equal(Number(cy.$id('ab').style('text-opacity')), 0, 'with its label');
    assert.equal(cy.$id('ab').visible(), true, 'Cytoscape still counts it as visible, so it is routed');
    assert.equal(opacity('cd'), 1, 'other edges stay visible');
    await wait(30);
    assert.equal(opacity('ab'), 0, 'still hidden before the delay');
    await wait(120);
    assert.equal(opacity('ab'), 1, 'shown once routed for the resting position');

    a.position({ x: 0, y: 40 });
    assert.equal(opacity('ab'), 0);
    setGrabbed(a, false);
    a.emit('free');
    await wait(30);
    assert.equal(opacity('ab'), 1, 'shown on release');

    // routed in full at y 40; dragged away and back: the skipped run must still show it
    setGrabbed(a, true);
    a.position({ x: 0, y: 60 });
    a.position({ x: 0, y: 40 });
    assert.equal(opacity('ab'), 0);
    setGrabbed(a, false);
    a.emit('free');
    await wait(30);
    assert.equal(opacity('ab'), 1, 'shown although the release did not re-route');
  }
  finally
  {
    cy.destroy();
  }
});

test("hideEdgesOnDrag restores the app's own bypasses", async () =>
{
  const cy = createCy(obstacleElements());
  const routing = cy.libavoid({ avoidLib: avoid, hideEdgesOnDrag: true, rerouteOnDrag: false });
  try
  {
    await routing.ready;
    const ab = cy.$id('ab');
    ab.style('line-opacity', 0.5);
    const a = cy.$id('a');
    setGrabbed(a, true);
    a.position({ x: 0, y: 20 });
    assert.equal(Number(ab.style('line-opacity')), 0);
    setGrabbed(a, false);
    a.emit('free');
    await wait(30);
    assert.equal(Number(ab.style('line-opacity')), 0.5);

    ab.removeStyle('line-opacity'); // no bypass of its own: the stylesheet value comes back
    setGrabbed(a, true);
    a.position({ x: 0, y: 40 });
    setGrabbed(a, false);
    a.emit('free');
    await wait(30);
    assert.equal(Number(ab.style('line-opacity')), 1);
  }
  finally
  {
    cy.destroy();
  }
});

test('a failing re-route emits avoiderror and the plugin keeps running', async () =>
{
  const cy = createCy(obstacleElements());
  let broken = false;
  // libavoid that fails while `broken` is set
  const flaky = new Proxy(avoid, {
    get: (target, key, receiver) =>
      key === 'Router' && broken ?
        function()
        {
          throw new Error('libavoid broke');
        } :
        Reflect.get(target, key, receiver),
  });
  const routing = cy.libavoid({ avoidLib: flaky });
  const errors: unknown[] = [];
  cy.on('avoiderror', (_evt, error) => errors.push(error));
  const consoleError = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => logged.push(args); // the plugin also logs the error
  try
  {
    await routing.ready;
    broken = true;
    cy.$id('c').position({ x: 150, y: 20 });
    await wait(30);
    cy.$id('a').data('value', 1); // same geometry: the failed input is not retried
    await wait(30);
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]), /libavoid broke/);
    assert.equal(logged.length, 1, 'logged once');

    broken = false;
    cy.$id('c').position({ x: 150, y: 300 });
    await wait(30);
    assert.equal(routing.getRoute('ab')?.length, 2, 'routes again once the input is valid');
  }
  finally
  {
    console.error = consoleError;
    cy.destroy();
  }
});

test('setOptions reports invalid options to the caller', async () =>
{
  const cy = createCy(obstacleElements());
  const routing = cy.libavoid({ avoidLib: avoid });
  try
  {
    await routing.ready;
    const bad = { routingOptions: { bogus: true } } as unknown as Partial<RoutingOptions>;
    assert.throws(() => routing.setOptions(bad), /unknown routing option "bogus"/);
  }
  finally
  {
    cy.destroy();
  }
});

test('destroy() before libavoid is ready leaves the edges untouched', async () =>
{
  const cy = createCy(obstacleElements());
  const routes = countRoutes(cy);
  const routing = cy.libavoid({ avoidLib: avoid });
  routing.destroy();
  try
  {
    await routing.ready;
    assert.equal(routes.count, 0);
    assert.equal(cy.$id('ab').style('curve-style'), 'taxi');
  }
  finally
  {
    cy.destroy();
  }
});

test('live: false routes only on request, switching it on starts listening', async () =>
{
  const cy = createCy(obstacleElements());
  const routes = countRoutes(cy);
  const routing = cy.libavoid({ avoidLib: avoid, live: false });
  try
  {
    await routing.ready;
    assert.equal(routes.count, 1, 'the first run still happens');

    cy.$id('c').position({ x: 150, y: 300 });
    await wait(30);
    assert.equal(routes.count, 1, 'no automatic re-route');
    await routing.refresh();
    assert.equal(routing.getRoute('ab')?.length, 2, 'refresh() picks up the change');

    routing.setOptions({ live: true });
    await wait(30); // setOptions() routes too
    routes.reset();
    cy.$id('c').position({ x: 150, y: 0 });
    await wait(30);
    assert.equal(routes.count, 1, 're-routes automatically again');
    assert.ok((routing.getRoute('ab')?.length ?? 0) >= 4);
  }
  finally
  {
    cy.destroy();
  }
});

test('routes while dragging are drafts; releasing routes once more in full', async () =>
{
  const cy = createCy(obstacleElements());
  const routes = countRoutes(cy);
  const routing = cy.libavoid({ avoidLib: avoid, dragRouteInterval: 0 });
  try
  {
    await routing.ready;
    routes.reset();
    const c = cy.$id('c');
    setGrabbed(c, true);
    c.position({ x: 150, y: 20 });
    await wait(30);
    assert.equal(routes.count, 1, 'a draft while dragging');
    setGrabbed(c, false);
    c.emit('free'); // released where it is: same geometry
    await wait(30);
    assert.equal(routes.count, 2, 'the full run after the release');
    cy.$id('a').data('value', 1);
    await wait(30);
    assert.equal(routes.count, 2, 'and nothing more while the geometry stays');
  }
  finally
  {
    cy.destroy();
  }
});
