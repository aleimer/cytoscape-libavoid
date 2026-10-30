import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DragTracker } from '../src/cytoscape-adapter/drag-tracker';
import { RouteScheduler } from '../src/cytoscape-adapter/route-scheduler';
import type { ScheduleTiming } from '../src/cytoscape-adapter/route-scheduler';
import { createCy, obstacleElements, setGrabbed, wait } from './helpers';

function scheduler(timing: Partial<ScheduleTiming> = {}): { scheduler: RouteScheduler; runs: () => number; }
{
  let runs = 0;
  const scheduler = new RouteScheduler(
    { dragging: () => false, restDelay: () => 0, pause: () => 0, ...timing },
    () => runs++,
  );
  return { scheduler, runs: () => runs };
}

test('RouteScheduler coalesces calls into one run per frame', async () =>
{
  const { scheduler: s, runs } = scheduler();
  for (let i = 0; i < 10; i++)
  {
    s.schedule();
  }
  await wait(20);
  assert.equal(runs(), 1);
  s.schedule();
  await wait(20);
  assert.equal(runs(), 2, 'schedules again after the run');
});

test('RouteScheduler waits for the rest delay while dragging, restarted by every call', async () =>
{
  const { scheduler: s, runs } = scheduler({ dragging: () => true, restDelay: () => 50 });
  for (let i = 0; i < 5; i++)
  {
    s.schedule();
    await wait(20);
  }
  assert.equal(runs(), 0, 'still moving');
  await wait(60);
  assert.equal(runs(), 1, 'once it rests');
});

test('RouteScheduler: a run scheduled before a drag started waits for the rest delay', async () =>
{
  let dragging = false;
  const { scheduler: s, runs } = scheduler({ dragging: () => dragging, restDelay: () => 50 });
  s.schedule(); // e.g. a style event of the mousedown, before 'grab'
  dragging = true;
  s.schedule(); // the first move
  await wait(20);
  assert.equal(runs(), 0, 'the frame run gives way to the rest delay');
  await wait(60);
  assert.equal(runs(), 1, 'once it rests');
});

test('RouteScheduler pauses between runs while dragging', async () =>
{
  const { scheduler: s, runs } = scheduler({ dragging: () => true, pause: () => 60 });
  s.schedule();
  await wait(30);
  assert.equal(runs(), 0, 'within the pause');
  await wait(60);
  assert.equal(runs(), 1);
});

test('RouteScheduler.stop() drops scheduled runs and ignores later calls', async () =>
{
  const { scheduler: s, runs } = scheduler({ dragging: () => true, restDelay: () => 10 });
  s.schedule();
  s.stop();
  s.schedule();
  await wait(40);
  assert.equal(runs(), 0);
});

test('DragTracker follows grab / free / remove and survives a missed free', () =>
{
  const cy = createCy(obstacleElements());
  const tracker = new DragTracker();
  cy.on('grab', 'node', tracker.onGrab);
  cy.on('free remove', 'node', tracker.onRelease);
  try
  {
    const a = cy.$id('a');
    assert.equal(tracker.active, false);
    setGrabbed(a, true);
    assert.equal(tracker.active, true);
    setGrabbed(a, false); // released without a 'free' event
    assert.equal(tracker.active, false);

    setGrabbed(a, true);
    a.remove();
    assert.equal(tracker.active, false, 'removed while grabbed');

    const b = cy.$id('b');
    setGrabbed(b, true);
    const late = new DragTracker();
    late.reset(cy);
    assert.equal(late.active, true, 'reset() picks up nodes grabbed before');
  }
  finally
  {
    cy.destroy();
  }
});
