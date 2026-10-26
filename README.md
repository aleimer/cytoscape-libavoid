# cytoscape-libavoid

Cytoscape.js extension for obstacle-avoiding edge routing with
[libavoid](https://www.adaptagrams.org/documentation/libavoid.html) (via
[libavoid-js](https://github.com/Aksem/libavoid-js), WebAssembly).

Full developer documentation (German): [docs/DOKUMENTATION.md](docs/DOKUMENTATION.md)

- orthogonal (taxi-style) or polyline routes that go around nodes
- **docking ports**: every edge gets its own place on the outgoing / incoming
  node side, stacked by edge width and sorted to avoid crossings right at the node
- parallel segments are nudged apart, optional rounded corners
- live re-routing on add / remove / move / data changes, also while dragging

Routes are applied as Cytoscape `segments` / `round-segments` style bypasses,
so all usual edge styling (colour, arrows, opacity, …) keeps working.

## Usage

The plugin is plain TypeScript in [src/](src/), compiled by your project's own
toolchain:

| File | Main export | |
|---|---|---|
| `index.ts` | `LibavoidRouting` | plugin wrapper: `cytoscape.use()` registration, `cy.libavoid()`, live re-routing |
| `routing.ts` | `EdgeRouter` | routing logic incl. docking ports; works on a plain graph model, independent of Cytoscape |
| `libavoid.ts` | `LibavoidRouter` | libavoid connector: loads the WebAssembly module, wraps its API and memory handling |
| `edge-style.ts` | `EdgeStyler` | converts routes to Cytoscape edge styles and applies / removes them |

Copy that folder into your code base, then:

```sh
npm install cytoscape libavoid-js
```

```ts
import cytoscape from 'cytoscape';
import cytoscapeLibavoid from './cytoscape-libavoid';

cytoscape.use(cytoscapeLibavoid);

const cy = cytoscape({ /* … */ });
const routing = cy.libavoid({
  ports: 'docking',
  flowDirection: 'right',
  cornerRadius: 6,
  wasmUrl: 'libavoid.wasm', // see "WebAssembly file" below
});
await routing.ready; // edges are routed now
```

Your tsconfig needs `moduleResolution: "bundler"` (or `"node"`) and
`skipLibCheck: true`, since libavoid-js ships broken `.d.ts` files.
[src/README.md](src/README.md)
has the step-by-step setup, incl. Angular.

### WebAssembly file

libavoid needs `libavoid.wasm` (~480 kB) at runtime.

- **Browser**: serve `node_modules/libavoid-js/dist/libavoid.wasm` as a static
  asset and pass its URL as `wasmUrl`.
- **Node.js**: works without options.
- Already loaded libavoid elsewhere? Pass the instance as `avoidLib`.

## Options

| Option | Default | |
|---|---|---|
| `routingType` | `'orthogonal'` | `'orthogonal'` or `'polyline'` |
| `ports` | `'auto'` | `'auto'`: one shared pin per side, libavoid chooses. `'docking'`: one docking port per edge end |
| `flowDirection` | `'right'` | docking ports: `'right'`, `'left'`, `'down'`, `'up'` |
| `portSpacing` | `2` | docking ports: gap between neighbouring ports (px) |
| `shapeBufferDistance` | `12` | clearance kept around nodes (px) |
| `idealNudgingDistance` | `'auto'` | distance between parallel segments; auto = max edge width + `portSpacing` |
| `nudgeConnectedSegments` | `'auto'` | spread endpoints that share a pin; auto = on for `ports: 'auto'` |
| `cornerRadius` | `0` | > 0 renders rounded corners |
| `edges` | `'edge'` | selector of edges to route |
| `obstacles` | `'node:childless'` | selector of nodes acting as obstacles |
| `includeLabels` | `false` | node labels count as part of the obstacle |
| `edgeWidth` | `e => e.numericStyle('width')` | width used for stacking / nudging |
| `live` | `true` | re-route automatically on graph changes |
| `rerouteOnDrag` | `true` | when live: re-route while dragging (`false` = on release only) |
| `dragRouteInterval` | `'auto'` | pause between re-routes while dragging (ms); `'auto'` = as long as the last run took, `0` = every frame |
| `routingParameters` | `{}` | raw libavoid `RoutingParameter`s, e.g. `{ crossingPenalty: 200 }` |
| `routingOptions` | `{}` | raw libavoid `RoutingOption`s |
| `wasmUrl` / `avoidLib` | – | see above |
| `worker` | – | a `Worker` running `routing.worker.ts`, see below |

Per edge, `data(sourceSide)` / `data(targetSide)` (`'top' | 'right' | 'bottom' | 'left'`)
force the side an edge leaves or enters a node (docking ports).

## Performance

Every run routes the whole graph. Routing time in Node.js (`npm run perf`, the
material-flow graphs of the Angular bench):

| Graph | `ports: 'auto'` | `ports: 'docking'` | `routingType: 'polyline'` |
|---|--:|--:|--:|
| 45 nodes, 53 edges | ~6 ms | ~5 ms | ~85 ms |
| 128 nodes, 182 edges | ~49 ms | ~71 ms | ~2100 ms |
| 300 nodes, 488 edges | ~470 ms | ~1030 ms | – |

- While dragging, `dragRouteInterval: 'auto'` spaces re-routes out so routing
  takes at most about half of the time. On the 128-node graph this lifts a drag
  from 22 to 105 fps; edges follow ~5 times per second and the final position
  is routed on release.
- Prefer `orthogonal`: `polyline` is many times slower.
- libavoid's `performUnifyingNudgingPreprocessingStep` is switched off by
  default. It took ~98 % of the routing time (64 nodes / 112 edges: 3.4 s →
  50 ms, docking ports 16 s → 140 ms) for slightly fewer bends. Turn it back on
  with `routingOptions: { performUnifyingNudgingPreprocessingStep: true }`.

## API

```js
const routing = cy.libavoid(options); // new instance (replaces a previous one)
cy.libavoid();                        // current instance
routing.ready;                        // Promise, resolves after the first routing
routing.route();                      // route now, returns Map<edgeId, points> (not with a worker)
await routing.refresh();              // route now, also with a worker
routing.getRoute(edgeOrId);           // [{x, y}, …] incl. both endpoints
routing.setOptions({ ports: 'auto' });// change options and re-route
routing.destroy();                    // stop and restore the original edge styles

cy.on('avoidrouted', (evt, { edges, routingMs, totalMs }) => { … });
cy.on('avoiderror', (evt, error) => { … }); // an automatic re-route failed (also logged)
```

The options are documented on the `LibavoidOptions` / `RoutingOptions` types,
so they show up in the editor.

### Routing in a Web Worker

On large graphs a run takes 100 ms to 1 s (see Performance), which blocks the
page. With a worker, the main thread only builds the model and applies the
styles:

```ts
const worker = new Worker(new URL('./cytoscape-libavoid/routing.worker', import.meta.url), { type: 'module' });
const routing = cy.libavoid({ worker, wasmUrl: 'libavoid.wasm' });
```

`src/routing.worker.ts` is the worker entry; Angular, Vite and webpack 5 bundle
it from the `new URL(...)` pattern above. Only one request is in flight at a
time; changes made meanwhile are sent as soon as it is answered. In the Angular
bench (128 nodes, docking ports) a drag runs at 168 fps with a worker vs. 107
fps without, adding and removing nodes costs 48 ms instead of 260 ms of script
time. `route()` is synchronous and therefore not available with a worker; use
`refresh()`. The demo runs with a worker via `?worker=1`.

### Using the classes directly

`EdgeRouter` routes a plain graph model, without Cytoscape, e.g. in Node.js or
for another renderer:

```ts
import { EdgeRouter, loadLibavoid } from './cytoscape-libavoid';

const avoid = await loadLibavoid();
const router = new EdgeRouter(avoid, { ports: 'docking', flowDirection: 'down' });
const routes = router.route({
  nodes: [
    { id: 'a', x: 0, y: 0, width: 80, height: 40 }, // x / y = centre
    { id: 'b', x: 0, y: 200, width: 80, height: 40 },
  ],
  edges: [{ id: 'ab', source: 'a', target: 'b', width: 4 }],
});
routes.get('ab'); // [{ x, y }, …] from source to target
```

`EdgeStyler` writes such routes onto Cytoscape edges (`apply(routes,
cornerRadius)`, `clear()`), and `LibavoidRouter` is the thin layer over the
libavoid API that `EdgeRouter` builds on. `computeDockingPorts`,
`spreadPorts`, `routeToEdgeStyle` and `simplify` are exported as plain functions.

## Development

```sh
npm install
npm run typecheck   # tsc over everything, plus src/ with every strictness flag (tsconfig.strict.json)
npm test            # node:test, incl. a headless Cytoscape integration test
npm run perf        # routing core benchmark
npm run demo        # bundle demo/main.ts and serve it at http://localhost:8080/demo/
```

Node runs the TypeScript directly (type stripping); `scripts/ts-resolve.ts`
maps the plugin's extensionless imports to `.ts` files. The Angular app in
[bench/angular/](bench/angular/README.md) benchmarks a copy of `src/`
together with other Cytoscape plugins.

## License

The cytoscape-libavoid source code is licensed under the [MIT License](LICENSE).

libavoid and libavoid-js are licensed under LGPL-2.1-or-later. An app built
with the plugin bundles libavoid-js, so the LGPL obligations apply when you ship it.
See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) and the (German)
license notes in [docs/LIZENZ.md](docs/LIZENZ.md).
