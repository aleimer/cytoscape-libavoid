// Drags a node of the demo in a real browser, with the real mouse events and
// their real order, which the headless tests only simulate. Run with
// `npm run test:e2e` (builds the demo first). Uses the installed Chrome;
// CHROME_PATH selects another Chromium-based browser.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import type { Core } from 'cytoscape';
import type { LibavoidOptions, LibavoidRouting } from '../../src';

declare global {
  interface Window {
    /** Set by demo/main.ts. */
    demo: { cy: Core; routing: LibavoidRouting };
    /** Counts `avoidrouted` events, see countRoutes(). */
    routed: number;
  }
}

const PORT = 8791;
let server: ChildProcess;
let browser: Browser;
let page: Page;

before(async () => {
  server = spawn(process.execPath, ['scripts/serve.ts'], { env: { ...process.env, PORT: String(PORT) } });
  await new Promise<void>((resolve, reject) => {
    server.stdout!.on('data', (chunk: Buffer) => chunk.toString().includes('demo:') && resolve());
    server.once('exit', (code) => reject(new Error(`demo server exited with ${code}`)));
  });
  const executablePath = process.env['CHROME_PATH'];
  browser = await chromium.launch(executablePath ? { executablePath } : { channel: 'chrome' });
  page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://localhost:${PORT}/demo/`);
  await page.waitForFunction(() => window.demo !== undefined);
  await page.evaluate(() => window.demo.routing.ready);
  assert.deepEqual(errors, []);
});

after(async () => {
  await browser?.close();
  server?.kill();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Starts counting `avoidrouted` events from 0. */
async function countRoutes(): Promise<void> {
  await page.evaluate(() => {
    window.routed = 0;
    window.demo.cy.off('avoidrouted');
    window.demo.cy.on('avoidrouted', () => window.routed++);
  });
}

/** Returns nothing: Playwright would serialise the returned routing object, which blocks the page for seconds. */
async function setOptions(options: Partial<LibavoidOptions>): Promise<void> {
  await page.evaluate((changes) => {
    window.demo.routing.setOptions(changes);
  }, options);
}

const routed = () => page.evaluate(() => window.routed);
const opacity = (edgeId: string) => page.evaluate((id) => Number(window.demo.cy.$id(id).style('line-opacity')), edgeId);

/** Where a node is on the page. */
function nodeOnPage(id: string): Promise<{ x: number; y: number }> {
  return page.evaluate((nodeId) => {
    const { x, y } = window.demo.cy.$id(nodeId).renderedPosition();
    const container = window.demo.cy.container()!.getBoundingClientRect();
    return { x: container.left + x, y: container.top + y };
  }, id);
}

test('dragRouteDelay + hideEdgesOnDrag: hidden while moving, routed when resting, routed in full on release', async () => {
  await setOptions({ dragRouteDelay: 200, hideEdgesOnDrag: true });
  await sleep(300);
  await countRoutes();
  const visible = await opacity('saege-montage'); // the stylesheet's line-opacity

  const start = await nodeOnPage('montage');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step++) {
    await page.mouse.move(start.x + step * 8, start.y + step * 4);
    await sleep(30);
  }
  assert.equal(await page.evaluate(() => window.demo.cy.$id('montage').grabbed()), true, 'Cytoscape grabbed the node');
  assert.equal(await opacity('saege-montage'), 0, 'its edges are hidden while it moves');
  assert.equal(await opacity('lager-saege'), visible, 'other edges stay');
  assert.equal(await routed(), 0, 'no routing while it moves');

  await sleep(400); // resting, still held
  assert.equal(await routed(), 1, 'routed once it rests');
  assert.equal(await opacity('saege-montage'), visible, 'and shown again');

  await page.mouse.up();
  await sleep(300);
  assert.equal(await routed(), 2, 'routed once more in full on release');
  assert.equal(await opacity('saege-montage'), visible);
  const moved = await page.evaluate(() => window.demo.cy.$id('montage').position());
  assert.ok(moved.x > 540, 'the node moved');
});

test('without the options, routes follow the drag', async () => {
  await setOptions({ dragRouteDelay: 0, hideEdgesOnDrag: false });
  await sleep(300);
  await countRoutes();
  const visible = await opacity('lager-fraese');

  const start = await nodeOnPage('fraese');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step++) {
    await page.mouse.move(start.x, start.y + step * 6);
    await sleep(40);
  }
  assert.ok((await routed()) >= 1, 'draft runs while moving');
  assert.equal(await opacity('lager-fraese'), visible, 'edges stay visible');
  await page.mouse.up();
});
