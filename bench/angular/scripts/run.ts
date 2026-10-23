// Benchmark runner: builds the app, serves it, drives headless Chrome over the
// DevTools protocol and runs every config x zone mode x scenario of bench.matrix.json.
//
//   node scripts/run.ts [--no-build] [--matrix bench.matrix.json] [--only <text>]
//                       [--zones zone,zoneless] [--throttle 4] [--headed]
//
// Needs Node >= 22.18 (runs TypeScript directly) and Chrome (or CHROME_PATH).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { parseArgs } from 'node:util';

interface MatrixRun {
  name: string;
  plugins: string[];
  ports?: 'auto' | 'sankey';
  rerouteOnDrag?: boolean;
}

interface Matrix {
  size: 'S' | 'M' | 'L';
  zones: string[];
  scenarios: string[];
  runs: MatrixRun[];
}

interface Row {
  run: string;
  zone: string;
  scenario: string;
  wallMs: number;
  cpuPct: number;
  taskMs: number;
  scriptMs: number;
  layoutMs: number;
  styleMs: number;
  [key: string]: unknown;
}

const { values: args } = parseArgs({
  options: {
    'no-build': { type: 'boolean', default: false },
    matrix: { type: 'string', default: 'bench.matrix.json' },
    only: { type: 'string' },
    zones: { type: 'string' },
    throttle: { type: 'string', default: '1' },
    headed: { type: 'boolean', default: false },
  },
});

const root = join(import.meta.dirname, '..');
const matrix: Matrix = JSON.parse(await readFile(join(root, args.matrix), 'utf8'));
const zones = args.zones ? args.zones.split(',') : matrix.zones;
const runs = matrix.runs.filter((r) => !args.only || r.name.includes(args.only));
const throttle = Number(args.throttle) || 1;

if (!args['no-build']) {
  console.log('building…');
  const b = spawnSync('npx ng build', { cwd: root, stdio: 'inherit', shell: true });
  if (b.status !== 0) process.exit(b.status ?? 1);
}

// --- static server for dist/ ---
const dist = join(root, 'dist/angular/browser');
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.ico': 'image/x-icon' };
const server = createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^[\\/]+/, '');
  if (path.startsWith('..')) return void res.writeHead(403).end();
  if (!path || !extname(path)) path = 'index.html';
  try {
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(await readFile(join(dist, path)));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

// --- Chrome + DevTools protocol ---
const chromePath = [
  process.env['CHROME_PATH'],
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && existsSync(p));
if (!chromePath) throw new Error('Chrome not found, set CHROME_PATH');

const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(chromePath, [
  ...(args.headed ? [] : ['--headless=new']),
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${join(tmpdir(), `cy-bench-${port}`)}`,
  '--window-size=1600,1000',
  '--no-first-run',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let wsUrl: string | undefined;
for (let i = 0; i < 100 && !wsUrl; i++) {
  await sleep(100);
  try {
    const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
    wsUrl = targets.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
  } catch {
    // not up yet
  }
}
if (!wsUrl) throw new Error('could not connect to Chrome');

const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
const pageErrors: string[] = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(String(m.data));
  if (msg.id !== undefined) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p?.reject(new Error(msg.error.message));
    else p?.resolve(msg.result);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    pageErrors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    pageErrors.push(msg.params.args.map((a: any) => a.value ?? a.description).join(' '));
  }
};
const send = (method: string, params: object = {}): Promise<any> =>
  new Promise((resolve, reject) => {
    pending.set(++nextId, { resolve, reject });
    ws.send(JSON.stringify({ id: nextId, method, params }));
  });
const evaluate = async (expression: string): Promise<any> => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const metrics = async (): Promise<Record<string, number>> => {
  const r = await send('Performance.getMetrics');
  return Object.fromEntries(r.metrics.map((m: { name: string; value: number }) => [m.name, m.value]));
};

await send('Runtime.enable');
await send('Performance.enable', { timeDomain: 'threadTicks' });
if (throttle > 1) await send('Emulation.setCPUThrottlingRate', { rate: throttle });

// --- run the matrix ---
const rows: Row[] = [];
const inits: Array<{ run: string; zone: string; initMs: number; nodes: number; edges: number }> = [];
const started = Date.now();

for (const run of runs) {
  for (const zone of zones) {
    const q = new URLSearchParams({
      size: matrix.size,
      zone,
      plugins: run.plugins.join(','),
      ports: run.ports ?? 'sankey',
      drag: run.rerouteOnDrag === false ? '0' : '1',
    });
    pageErrors.length = 0;
    await send('Page.navigate', { url: `${base}?${q}` });
    let info: any;
    for (let i = 0; i < 300 && !info; i++) {
      await sleep(200);
      info = await evaluate('window.bench && { initMs: window.bench.initMs, elements: window.bench.elements, scenarios: window.bench.scenarios }').catch(() => undefined);
    }
    if (!info) throw new Error(`page did not get ready for ${run.name} / ${zone}: ${pageErrors.join('; ')}`);
    inits.push({ run: run.name, zone, initMs: info.initMs, ...info.elements });
    console.log(`\n${run.name} · ${zone} · ${info.elements.nodes} nodes / ${info.elements.edges} edges · init ${info.initMs} ms`);

    for (const scenario of matrix.scenarios.filter((s) => info.scenarios.includes(s))) {
      await sleep(300); // let the previous scenario's leftovers finish
      const m0 = await metrics();
      const r = await evaluate(`window.bench.run(${JSON.stringify(scenario)})`);
      const m1 = await metrics();
      const d = (k: string) => (m1[k] - m0[k]) * 1000;
      const row: Row = {
        run: run.name,
        zone,
        ...r,
        cpuPct: Math.round((d('TaskDuration') / r.wallMs) * 100),
        taskMs: Math.round(d('TaskDuration')),
        scriptMs: Math.round(d('ScriptDuration')),
        layoutMs: Math.round(d('LayoutDuration')),
        styleMs: Math.round(d('RecalcStyleDuration')),
      };
      rows.push(row);
      console.log(
        `  ${scenario.padEnd(15)} cpu ${String(row.cpuPct).padStart(3)}%  script ${String(row.scriptMs).padStart(5)} ms  `
          + `fps ${String(r.fps).padStart(5)}  p95 ${String(r.p95FrameMs).padStart(5)} ms  routes ${String(r.routeRuns).padStart(3)}  CD ${r.cdTicks}`,
      );
    }
    if (pageErrors.length) console.log(`  page errors: ${[...new Set(pageErrors)].join(' | ')}`);
  }
}

ws.close();
chrome.kill();
server.close();

// --- report ---
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = join(root, 'results');
await mkdir(outDir, { recursive: true });
const env = { date: new Date().toISOString(), size: matrix.size, cpuThrottle: throttle, chrome: chromePath, durationS: Math.round((Date.now() - started) / 1000) };
await writeFile(join(outDir, `${stamp}.json`), JSON.stringify({ env, inits, rows }, null, 2));

const cols: Array<[string, keyof Row | string]> = [
  ['run', 'run'], ['zone', 'zone'], ['scenario', 'scenario'], ['wall ms', 'wallMs'], ['CPU %', 'cpuPct'], ['task ms', 'taskMs'],
  ['script ms', 'scriptMs'], ['fps', 'fps'], ['p95 frame ms', 'p95FrameMs'], ['long task ms', 'longTaskMs'],
  ['routes', 'routeRuns'], ['routing ms', 'routingMs'], ['CD ticks', 'cdTicks'],
];
const md = [
  `# cytoscape bench ${env.date}`,
  '',
  `size ${env.size} · CPU throttle ${throttle}x · ${env.durationS} s`,
  '',
  '| run | zone | init ms | nodes | edges |',
  '|---|---|--:|--:|--:|',
  ...inits.map((i) => `| ${i.run} | ${i.zone} | ${i.initMs} | ${i.nodes} | ${i.edges} |`),
  '',
  `| ${cols.map((c) => c[0]).join(' | ')} |`,
  `|${cols.map((_, i) => (i < 3 ? '---' : '--:')).join('|')}|`,
  ...rows.map((r) => `| ${cols.map(([, k]) => String(r[k as keyof Row] ?? '')).join(' | ')} |`),
  '',
].join('\n');
await writeFile(join(outDir, `${stamp}.md`), md);
console.log(`\nresults: results/${stamp}.md (+ .json)`);
