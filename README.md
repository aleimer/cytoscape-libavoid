# cytoscape-libavoid

Cytoscape.js extension for obstacle-avoiding edge routing with
[libavoid](https://www.adaptagrams.org/documentation/libavoid.html) (via
[libavoid-js](https://github.com/Aksem/libavoid-js), WebAssembly).

Full developer documentation (German): [docs/DOKUMENTATION.md](docs/DOKUMENTATION.md)

Changes and how to update from 0.1.0: [CHANGELOG.md](CHANGELOG.md)

- orthogonal (taxi-style) routes that go around nodes
- **no edges on top of each other**: where libavoid stacks edges in a narrow gap
  between nodes, they are spread apart by their widths, and edges that do not
  fit are sent through the nearest wider gap (see "Route quality")
- edge labels on the longest segment instead of a corner, optional rounded corners
- live re-routing on add / remove / move / data changes, also while dragging,
  optionally in a Web Worker

Routes are applied as Cytoscape `segments` / `round-segments` style bypasses,
so all usual edge styling (colour, arrows, opacity, …) keeps working.

## Usage

The plugin is plain TypeScript in [src/](src/), compiled by your project's own
toolchain:

| File / folder | Main exports | |
|---|---|---|
| `index.ts` | `register` (default) | public API: `cytoscape.use()` registration and what an app needs |
| `routing.worker.ts` | – | entry of the optional Web Worker |
| `shared/` | `Point`, `Side`, `GraphModel` | the base used by all folders: geometry, the plain graph model routing works on, plugin messages and option checks |
| `cytoscape-adapter/` | `LibavoidRouting` | the only folder that knows Cytoscape: `cy.libavoid()`, options, live re-routing, converting routes to edge styles |
| `routing/` | `EdgeRouter`, `RoutingBackend` | routing logic, independent of Cytoscape; `LocalRouter` routes in this thread |
| `postprocess/` | `routeQuality` | spreads apart overlapping edges, finds detours for crowded gaps, measures route quality, all on one `RouteGeometry` |
| `libavoid/` | `loadLibavoid` | libavoid connector: loads the WebAssembly module, wraps its API and memory handling; stand-in typings for libavoid-js |
| `worker/` | `WorkerRouter` | routing in a Web Worker: messages and the plugin's side |

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
| `edgeSpacing` | `2` | gap between neighbouring parallel edges (px) |
| `shapeBufferDistance` | `12` | clearance kept around nodes (px) |
| `idealNudgingDistance` | `'auto'` | distance between parallel segments; auto = max edge width + `edgeSpacing` |
| `nudgeConnectedSegments` | `true` | spread apart edge ends that share the pin in the middle of a node side |
| `separateOverlaps` | `true` | spread apart edges that libavoid leaves on top of each other |
| `detourCrowded` | `true` | route edges that do not fit into a narrow gap through a wider one (second libavoid run) |
| `cornerRadius` | `0` | > 0 renders rounded corners |
| `labelPosition` | `'middle'` | `'longest-segment'`: edge labels on the centre of the longest segment (replaces `text-margin-x/y`) |
| `edges` | `'edge'` | selector of edges to route |
| `obstacles` | `'node:childless'` | selector of nodes acting as obstacles; edges to other nodes (e.g. compound nodes) end on the side facing their other end |
| `includeLabels` | `false` | node labels count as part of the obstacle |
| `edgeWidth` | `e => e.numericStyle('width')` | width used for stacking / nudging |
| `edgeSides` | – | allowed sides per edge end, e.g. `e => ({ source: 'right', target: 'left' })`; default: libavoid picks any side |
| `live` | `true` | re-route automatically on graph changes |
| `rerouteOnDrag` | `true` | when live: re-route while dragging (`false` = on release only) |
| `dragRouteInterval` | `'auto'` | pause between re-routes while dragging (ms); `'auto'` = as long as the last run took, `0` = every frame |
| `dragRouteDelay` | `0` | while dragging, re-route only once the nodes have rested this long (ms); `0` = off |
| `hideEdgesOnDrag` | `false` | hide the edges of dragged nodes until they are routed for the new position |
| `routingParameters` | `{}` | raw libavoid `RoutingParameter`s, e.g. `{ crossingPenalty: 200 }` |
| `routingOptions` | `{}` | raw libavoid `RoutingOption`s |
| `wasmUrl` / `avoidLib` | – | see above |
| `worker` | – | a `Worker` running `routing.worker.ts`, see below |

Every edge attaches to one of four pins in the middle of the node sides; libavoid
picks the side and spreads the edge ends apart along it. Where more than two
edges end at one side, the thickest one ends at the centre of the side and the
others fan out around it (this may add crossings right next to the node).

## Route quality

libavoid keeps a clearance (`shapeBufferDistance`) around nodes and does not
nudge edges into it. Where many edges share a narrow gap between nodes, e.g.
between the columns of a group, it puts them on the same line. Two steps after
the libavoid run fix that:

1. `detourCrowded`: gaps used by more edges than fit keep the short, local
   edges; the ones passing through over the longest distance (at most 30 % of
   all edges) are routed again through the nearest wide gap, via checkpoints.
   The result is only kept if it clearly overlaps less without much more
   length or crossings.
2. `separateOverlaps`: the remaining overlapping segments are spread apart by
   their widths plus `edgeSpacing`, inside the gap (using part of the
   clearance if needed), never into a node. The first and last segment of a
   route only slide along the node side they end at, so edges that share the
   pin in the middle of a side fan out along it instead of ending on one line.
   If a side is too short for all its edges, they are squeezed together.

`npm run quality` measures overlaps, edges through nodes, crossings, bends and
length on the bench graphs. On 128 nodes / 182 edges:

| | overlapping strokes | crossings | length |
|---|--:|--:|--:|
| libavoid only | 61,940 px | 1310 | 140,154 |
| now | **6,157 px** | 1355 | 146,612 |

No edge runs through a node in any of them.

## Performance

Every run routes the whole graph. Time per run in Node.js (`npm run perf`, the
material-flow graphs of the Angular bench):

| Graph | libavoid only | default (incl. detours) |
|---|--:|--:|
| 45 nodes, 53 edges | ~6 ms | ~12 ms |
| 128 nodes, 182 edges | ~49 ms | ~130 ms |
| 300 nodes, 488 edges | ~480 ms | ~1230 ms |

- Detours need a second libavoid run, so a full run takes about twice as long.
  While a node is dragged, runs are drafts without detours; the release routes
  once more in full. With `worker` all of it stays off the main thread, which
  is the way to go for large graphs. `detourCrowded: false` skips it.
- While dragging, `dragRouteInterval: 'auto'` spaces re-routes out so routing
  takes at most about half of the time; edges follow ~5 times per second and
  the final position is routed on release.
- libavoid's `performUnifyingNudgingPreprocessingStep` is switched off by
  default. It took ~98 % of the routing time (64 nodes / 112 edges: 3.4 s →
  50 ms) for slightly fewer bends and does not
  help against the overlaps. Turn it back on with
  `routingOptions: { performUnifyingNudgingPreprocessingStep: true }`.

## API

```js
const routing = cy.libavoid(options); // new instance (replaces a previous one)
cy.libavoid();                        // current instance
routing.ready;                        // Promise, resolves after the first routing
await routing.refresh();              // route now, resolves to Map<edgeId, points>
routing.getRoute(edgeOrId);           // [{x, y}, …] incl. both endpoints
routing.setOptions({ cornerRadius: 0 });// change options and re-route; invalid options throw
routing.options;                      // the options in use (frozen)
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
bench (128 nodes) a drag runs at 175 fps with a worker vs. 87
fps without, adding and removing nodes costs 48 ms instead of 650 ms of script
time. The demo runs with a worker via `?worker=1`.

### Using the classes directly

`EdgeRouter` routes a plain graph model, without Cytoscape, e.g. in Node.js or
for another renderer:

```ts
import { EdgeRouter, loadLibavoid } from './cytoscape-libavoid';

const avoid = await loadLibavoid();
const router = new EdgeRouter(avoid, { shapeBufferDistance: 8 });
const routes = router.route({
  nodes: [
    { id: 'a', x: 0, y: 0, width: 80, height: 40 }, // x / y = centre
    { id: 'b', x: 0, y: 200, width: 80, height: 40 },
  ],
  edges: [{ id: 'ab', source: 'a', target: 'b', width: 4 }],
});
routes.get('ab'); // [{ x, y }, …] from source to target
```

`WorkerRouter` does the same in a Web Worker and returns a promise:

```ts
const router = new WorkerRouter(worker, wasmUrl); // a Worker running routing.worker.ts
const { routes, routingMs } = await router.route(model, defaultRoutingOptions);
```

Both implement `RoutingBackend`, the interface the plugin routes through.
`routeQuality(routes, model)` measures overlaps, crossings and length. Other
building blocks, e.g. `EdgeStyler` or `separateOverlaps`, are not part of the
public API; import them from their files if you need them.

## Development

```sh
npm install
npm run typecheck   # tsc over everything, plus src/ with every strictness flag (tsconfig.strict.json)
npm test            # node:test, incl. a headless Cytoscape integration test
npm run test:e2e    # drags nodes of the demo in Chrome (playwright-core, uses the installed Chrome)
npm run lint        # oxlint
npm run deps:check  # layering rules of src/ (.dependency-cruiser.cjs)
npm run deps        # import graph of src/ as Mermaid -> docs/dependencies.md
npm run perf        # routing core benchmark
npm run quality     # overlaps, crossings, bends, length on the bench graphs
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
