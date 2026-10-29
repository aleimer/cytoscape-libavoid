import { Component, ElementRef, NgZone, afterEveryRender, afterNextRender, inject, signal, viewChild } from '@angular/core';
import cytoscape from 'cytoscape';
import type { Core } from 'cytoscape';
import { BENCH_CONFIG } from './app.config';
import { PLUGIN_NAMES, configToQuery, describeConfig } from './config';
import type { BenchConfig, PluginName } from './config';
import { SIZES, buildGraph } from './graph';
import { attachPlugins, registerPlugins, stylesheet } from './plugins';
import { Probe, SCENARIOS } from './scenarios';
import type { Scenario, ScenarioContext, ScenarioResult } from './scenarios';

/** What scripts/run.ts talks to. */
export interface BenchApi {
  config: BenchConfig;
  label: string;
  elements: { nodes: number; edges: number };
  initMs: number;
  scenarios: string[];
  run(name: string): Promise<ScenarioResult>;
}

declare global {
  interface Window {
    bench?: BenchApi;
  }
}

@Component({
  selector: 'app-root',
  template: `
    <header>
      <label>Size
        <select [value]="draft().size" (change)="set('size', $any($event.target).value)">
          @for (s of sizes; track s) { <option [value]="s">{{ s }}</option> }
        </select>
      </label>
      <label>Zone
        <select [value]="draft().zone" (change)="set('zone', $any($event.target).value)">
          <option value="zoneless">zoneless</option>
          <option value="zone">zone.js (cy inside zone)</option>
          <option value="zone-outside">zone.js (runOutsideAngular)</option>
        </select>
      </label>
      @for (p of pluginNames; track p) {
        <label><input type="checkbox" [checked]="draft().plugins.includes(p)" (change)="togglePlugin(p)" /> {{ p }}</label>
      }
      <label><input type="checkbox" [checked]="draft().rerouteOnDrag" (change)="set('rerouteOnDrag', !draft().rerouteOnDrag)" /> rerouteOnDrag</label>
      <label>dragRouteInterval
        <select [value]="draft().dragRouteInterval" (change)="set('dragRouteInterval', $any($event.target).value === 'auto' ? 'auto' : +$any($event.target).value)">
          <option value="auto">auto</option>
          <option value="0">0 (every frame)</option>
          <option value="100">100 ms</option>
          <option value="250">250 ms</option>
        </select>
      </label>
      <label><input type="checkbox" [checked]="draft().worker" (change)="set('worker', !draft().worker)" /> worker</label>
      <button (click)="apply()">Apply (reload)</button>
      <span class="sep"></span>
      @for (s of scenarios(); track s.name) {
        <button [disabled]="busy()" [title]="s.description" (click)="run(s.name)">{{ s.name }}</button>
      }
      <button [disabled]="busy()" (click)="runAll()">run all</button>
      <span class="status">{{ status() }}</span>
    </header>
    <div #cy class="cy"></div>
    @if (results().length) {
      <table>
        <thead>
          <tr><th>scenario</th><th>wall ms</th><th>fps</th><th>p95 frame</th><th>max frame</th><th>long tasks</th><th>long task ms</th><th>routes</th><th>routing ms</th><th>CD ticks</th></tr>
        </thead>
        <tbody>
          @for (r of results(); track $index) {
            <tr><td>{{ r.scenario }}</td><td>{{ r.wallMs }}</td><td>{{ r.fps }}</td><td>{{ r.p95FrameMs }}</td><td>{{ r.maxFrameMs }}</td><td>{{ r.longTasks }}</td><td>{{ r.longTaskMs }}</td><td>{{ r.routeRuns }}</td><td>{{ r.routingMs }}</td><td>{{ r.cdTicks }}</td></tr>
          }
        </tbody>
      </table>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; height: 100vh; font: 13px system-ui, sans-serif; }
    header { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; padding: 8px 12px; border-bottom: 1px solid #d0d7de; }
    .sep { flex: 0 0 1px; align-self: stretch; background: #d0d7de; }
    .status { color: #57606a; }
    .cy { flex: 1; min-height: 0; position: relative; }
    table { border-collapse: collapse; font-variant-numeric: tabular-nums; max-height: 30vh; overflow: auto; display: block; }
    th, td { padding: 3px 10px; text-align: right; border-top: 1px solid #eaeef2; }
    th:first-child, td:first-child { text-align: left; }
  `,
})
export class App {
  private readonly ngZone = inject(NgZone);
  private readonly cyRef = viewChild.required<ElementRef<HTMLDivElement>>('cy');
  readonly config = inject(BENCH_CONFIG);
  readonly sizes = Object.keys(SIZES);
  readonly pluginNames = PLUGIN_NAMES;
  readonly draft = signal<BenchConfig>({ ...this.config });
  readonly status = signal('loading…');
  readonly busy = signal(true);
  readonly scenarios = signal<Scenario[]>([]);
  readonly results = signal<ScenarioResult[]>([]);
  private ctx?: ScenarioContext;

  constructor() {
    afterEveryRender(() => {
      if (this.ctx) this.ctx.probe.cdTicks++;
    });
    afterNextRender(() => void this.init());
  }

  set<K extends keyof BenchConfig>(key: K, value: BenchConfig[K]): void {
    this.draft.update((d) => ({ ...d, [key]: value }));
  }

  togglePlugin(p: PluginName): void {
    this.draft.update((d) => ({ ...d, plugins: d.plugins.includes(p) ? d.plugins.filter((x) => x !== p) : [...d.plugins, p] }));
  }

  apply(): void {
    location.search = configToQuery(this.draft());
  }

  /** zone: like most apps, cytoscape lives in the Angular zone; zone-outside: the recommended runOutsideAngular. */
  private inConfiguredZone<T>(fn: () => T): T {
    return this.config.zone === 'zone-outside' ? this.ngZone.runOutsideAngular(fn) : this.ngZone.run(fn);
  }

  private async init(): Promise<void> {
    const elements = buildGraph(SIZES[this.config.size]);
    const t0 = performance.now();
    const cy: Core = this.inConfiguredZone(() => {
      registerPlugins();
      return cytoscape({ container: this.cyRef().nativeElement, elements, style: stylesheet(this.config), layout: { name: 'preset' }, wheelSensitivity: 0.3 });
    });
    const probe = new Probe(cy);
    await this.inConfiguredZone(() => attachPlugins(cy, this.config));
    cy.fit(undefined, 30);
    await probe.settle();
    const initMs = Math.round(performance.now() - t0);

    const ctx: ScenarioContext = { cy, probe, has: (p) => this.config.plugins.includes(p as PluginName) };
    this.ctx = ctx;
    const available = SCENARIOS.filter((s) => !s.enabled || s.enabled(ctx));
    this.scenarios.set(available);

    (window as any).__cy = cy; // debugging aid
    window.bench = {
      config: this.config,
      label: describeConfig(this.config),
      elements: { nodes: cy.nodes().length, edges: cy.edges().length },
      initMs,
      scenarios: available.map((s) => s.name),
      run: (name) => this.run(name),
    };
    this.status.set(`${window.bench.label} · ${cy.nodes().length} nodes / ${cy.edges().length} edges · init ${initMs} ms`);
    this.busy.set(false);
  }

  async run(name: string): Promise<ScenarioResult> {
    const ctx = this.ctx;
    const scenario = this.scenarios().find((s) => s.name === name);
    if (!ctx || !scenario) throw new Error(`unknown scenario ${name}`);
    this.busy.set(true);
    // the harness itself must not cause change detection; the plugins' own handlers still do in 'zone' mode
    const result = await this.ngZone.runOutsideAngular(() => ctx.probe.measure(name, () => scenario.run(ctx)));
    this.results.update((r) => [...r, result]);
    this.busy.set(false);
    return result;
  }

  async runAll(): Promise<void> {
    for (const s of this.scenarios()) await this.run(s.name);
  }
}
