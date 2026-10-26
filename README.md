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
| `routingParameters` | `{}` | raw libavoid `RoutingParameter`s, e.g. `{ crossingPenalty: 200 }` |
| `routingOptions` | `{}` | raw libavoid `RoutingOption`s |
| `wasmUrl` / `avoidLib` | – | see above |

Per edge, `data(sourceSide)` / `data(targetSide)` (`'top' | 'right' | 'bottom' | 'left'`)
force the side an edge leaves or enters a node (docking ports).

**Performance note:** libavoid's `performUnifyingNudgingPreprocessingStep` is
switched off by default. It took ~98 % of the routing time (64 nodes / 112
edges: 3.4 s → 50 ms, docking ports 16 s → 140 ms) for slightly fewer bends. Turn it
back on with `routingOptions: { performUnifyingNudgingPreprocessingStep: true }`.

## API

```js
const routing = cy.libavoid(options); // new instance (replaces a previous one)
cy.libavoid();                        // current instance
routing.ready;                        // Promise, resolves after the first routing
routing.route();                      // route now, returns Map<edgeId, points>
routing.getRoute(edgeOrId);           // [{x, y}, …] incl. both endpoints
routing.setOptions({ ports: 'auto' });// change options and re-route
routing.destroy();                    // stop and restore the original edge styles

cy.on('avoidrouted', (evt, { edges, routingMs, totalMs }) => { … });
```

The options are documented on the `LibavoidOptions` / `RoutingOptions` types,
so they show up in the editor.

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
npm run typecheck   # tsc over the plugin, tests, scripts and demo (app-style settings)
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
