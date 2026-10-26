import type { Core, NodeSingular } from 'cytoscape';
import type { RoutedEventInfo } from './cytoscape-libavoid';
import { rng, series } from './graph';

// Scenarios simulate what a user does with the graph and record frame timing,
// long tasks, libavoid routing runs and Angular change detection ticks.
// CPU time is added by the runner (scripts/run.ts) through the DevTools protocol.

export interface ScenarioResult {
  scenario: string;
  wallMs: number;
  frames: number;
  fps: number;
  p95FrameMs: number;
  maxFrameMs: number;
  longTasks: number;
  longTaskMs: number;
  routeRuns: number;
  routingMs: number;
  cdTicks: number;
}

/** Counters fed by the app while a scenario runs. */
export class Probe {
  routeRuns = 0;
  routingMs = 0;
  lastRouteAt = 0;
  cdTicks = 0;

  constructor(cy: Core) {
    cy.on('avoidrouted', (_evt, info: RoutedEventInfo) => {
      this.routeRuns++;
      this.routingMs += info.routingMs;
      this.lastRouteAt = performance.now();
    });
  }

  async measure(scenario: string, body: () => Promise<void>): Promise<ScenarioResult> {
    const frameTimes: number[] = [];
    let last = performance.now();
    let running = true;
    const frame = (t: number) => {
      frameTimes.push(t - last);
      last = t;
      if (running) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);

    const longTasks: number[] = [];
    const obs = new PerformanceObserver((list) => list.getEntries().forEach((e) => longTasks.push(e.duration)));
    try {
      obs.observe({ type: 'longtask' });
    } catch {
      // not supported outside Chromium
    }

    const before = { routeRuns: this.routeRuns, routingMs: this.routingMs, cdTicks: this.cdTicks };
    const t0 = performance.now();
    await body();
    const wallMs = performance.now() - t0;
    running = false;
    obs.disconnect();

    const sorted = frameTimes.slice(1).sort((a, b) => a - b);
    const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
    return {
      scenario,
      wallMs: round(wallMs),
      frames: sorted.length,
      fps: round((sorted.length / wallMs) * 1000),
      p95FrameMs: round(q(0.95)),
      maxFrameMs: round(sorted[sorted.length - 1] ?? 0),
      longTasks: longTasks.length,
      longTaskMs: round(longTasks.reduce((s, d) => s + d, 0)),
      routeRuns: this.routeRuns - before.routeRuns,
      routingMs: round(this.routingMs - before.routingMs),
      cdTicks: this.cdTicks - before.cdTicks,
    };
  }

  /** Waits until no re-route happened for `quietMs` (and at least `minMs` passed). */
  async settle(minMs = 300, quietMs = 300, maxMs = 8000): Promise<void> {
    const t0 = performance.now();
    while (performance.now() - t0 < maxMs) {
      await sleep(50);
      const now = performance.now();
      if (now - t0 >= minMs && now - Math.max(this.lastRouteAt, t0) >= quietMs) return;
    }
  }
}

export interface ScenarioContext {
  cy: Core;
  probe: Probe;
  has: (plugin: string) => boolean;
}

export interface Scenario {
  name: string;
  description: string;
  enabled?: (ctx: ScenarioContext) => boolean;
  run: (ctx: ScenarioContext) => Promise<void>;
}

export const SCENARIOS: Scenario[] = [
  {
    name: 'idle',
    description: '3 s without interaction (detects re-route / change detection loops)',
    run: () => sleep(3000),
  },
  {
    name: 'drag',
    description: 'drag a node with mouse events for 1.5 s, then release',
    run: async ({ cy, probe }) => {
      const node = pickNode(cy);
      await mouseDrag(cy, node, 300, 120, 90);
      await probe.settle();
    },
  },
  {
    name: 'panzoom',
    description: '90 frames of zooming and panning',
    run: async ({ cy, probe }) => {
      const zoom = cy.zoom();
      const pan = cy.pan();
      for (let i = 0; i < 90; i++) {
        const t = i / 89;
        cy.viewport({ zoom: zoom * (1 + 0.5 * Math.sin(t * Math.PI * 2)), pan: { x: pan.x - 200 * t, y: pan.y - 80 * t } });
        await nextFrame();
      }
      cy.viewport({ zoom, pan });
      await probe.settle();
    },
  },
  {
    name: 'data',
    description: '10 live data updates of every node, 200 ms apart (no geometry change)',
    run: async ({ cy, probe }) => {
      const rand = rng(42);
      for (let i = 0; i < 10; i++) {
        cy.batch(() => cy.nodes('.process').forEach((n) => void n.data({ value: Math.round(rand() * 1000), series: series(rand) })));
        await sleep(200);
      }
      await probe.settle();
    },
  },
  {
    name: 'addRemove',
    description: 'add 20 nodes + 20 edges, settle, remove them again',
    run: async ({ cy, probe }) => {
      const bb = cy.nodes().boundingBox({});
      const sources = cy.nodes('.process').slice(0, 20);
      cy.batch(() => {
        sources.forEach((src, i) => {
          cy.add({ group: 'nodes', data: { id: `tmp${i}`, name: `T-${i}`, value: i, series: series(rng(i)) }, classes: 'process', position: { x: bb.x1 + i * 150, y: bb.y2 + 200 } });
          cy.add({ group: 'edges', data: { id: `tmpe${i}`, source: src.id(), target: `tmp${i}`, flow: 3 } });
        });
      });
      await probe.settle();
      cy.remove('[id ^= "tmp"]');
      await probe.settle();
    },
  },
  {
    name: 'collapseExpand',
    description: 'collapse all groups, then expand all (animated, fisheye)',
    enabled: ({ has }) => has('expandCollapse'),
    run: async ({ cy, probe }) => {
      const api = cy.expandCollapse();
      api.collapseAll();
      await probe.settle(1200);
      api.expandAll();
      await probe.settle(1200);
    },
  },
];

function pickNode(cy: Core): NodeSingular {
  // a node in the middle of the graph, so its edges cross the most
  const nodes = cy.nodes('.process');
  return nodes[Math.floor(nodes.length / 2)];
}

/** Drags like a user: mousedown on the node, mousemove every frame, mouseup. */
async function mouseDrag(cy: Core, node: NodeSingular, dx: number, dy: number, frames: number): Promise<void> {
  const rect = cy.container()!.getBoundingClientRect();
  const start = node.renderedPosition();
  const at = (t: number) => ({ clientX: rect.left + start.x + dx * t, clientY: rect.top + start.y + dy * t });
  const p0 = at(0);
  const target = document.elementFromPoint(p0.clientX, p0.clientY) ?? cy.container()!;
  target.dispatchEvent(new MouseEvent('mousedown', { ...p0, button: 0, buttons: 1, bubbles: true, cancelable: true }));
  for (let i = 1; i <= frames; i++) {
    await nextFrame();
    window.dispatchEvent(new MouseEvent('mousemove', { ...at(i / frames), button: 0, buttons: 1, bubbles: true, cancelable: true }));
  }
  await nextFrame();
  window.dispatchEvent(new MouseEvent('mouseup', { ...at(1), button: 0, buttons: 0, bubbles: true, cancelable: true }));
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));
const round = (v: number) => Math.round(v * 10) / 10;
