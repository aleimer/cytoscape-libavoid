# cytoscape-libavoid

Cytoscape.js extension for obstacle-avoiding edge routing with
[libavoid](https://www.adaptagrams.org/documentation/libavoid.html) (via
[libavoid-js](https://github.com/Aksem/libavoid-js), WebAssembly).

Full developer documentation (German): [docs/DOKUMENTATION.md](docs/DOKUMENTATION.md)

- orthogonal (taxi-style) or polyline routes that go around nodes
- **sankey ports** for material flow diagrams: every flow gets its own slot on
  the outgoing / incoming node side, stacked by edge width and sorted to avoid
  crossings right at the node
- parallel segments are nudged apart, optional rounded corners
- live re-routing on add / remove / move / data changes, also while dragging

Routes are applied as Cytoscape `segments` / `round-segments` style bypasses,
so all usual edge styling (colour, arrows, opacity, …) keeps working.

## Usage

### Bundler / ESM

```js
import cytoscape from 'cytoscape';
import cytoscapeLibavoid from 'cytoscape-libavoid';

cytoscape.use(cytoscapeLibavoid);

const cy = cytoscape({ /* … */ });
const routing = cy.libavoid({
  ports: 'sankey',
  flowDirection: 'right',
  cornerRadius: 6,
  wasmUrl: '/assets/libavoid.wasm', // see "WebAssembly file" below
});
await routing.ready; // edges are routed now
```

### Script tag

```html
<script src="cytoscape.min.js"></script>
<script src="cytoscape-libavoid/dist/cytoscape-libavoid.umd.js"></script>
<script>
  // registers itself on window.cytoscape; global: cytoscapeLibavoid
  const routing = cy.libavoid({ ports: 'sankey' });
</script>
```

### WebAssembly file

libavoid needs `libavoid.wasm` (in `dist/` after `npm run build`, ~480 kB).

- **UMD / ESM bundle from `dist/`**: found automatically when it sits next to
  the bundle.
- **Own bundler**: copy `node_modules/libavoid-js/dist/libavoid.wasm` into your
  public assets and pass `wasmUrl`.
- **Node.js**: works without options.
- Already loaded libavoid elsewhere? Pass the instance as `avoidLib`.

## Options

| Option | Default | |
|---|---|---|
| `routingType` | `'orthogonal'` | `'orthogonal'` or `'polyline'` |
| `ports` | `'auto'` | `'auto'`: one pin per side, libavoid chooses. `'sankey'`: stacked flow ports |
| `flowDirection` | `'right'` | sankey: `'right'`, `'left'`, `'down'`, `'up'` |
| `portSpacing` | `2` | sankey: gap between stacked flows (px) |
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
force the side a sankey flow leaves or enters a node.

**Performance note:** libavoid's `performUnifyingNudgingPreprocessingStep` is
switched off by default. It took ~98 % of the routing time (64 nodes / 112
edges: 3.4 s → 50 ms, sankey 16 s → 140 ms) for slightly fewer bends. Turn it
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

The routing core is renderer-independent and exported as well:
`routeGraph(Avoid, { nodes, edges }, options)`, `computeSankeyPorts`,
`routeToEdgeStyle`, `loadLibavoid(wasmUrl)`.

## Development

```sh
npm install
npm run typecheck  # tsc --noEmit over src, tests and scripts
npm test        # node:test, incl. a headless Cytoscape integration test
npm run build   # lib/ (ES modules + .d.ts) and dist/: ESM + UMD bundle, libavoid.wasm
npm run demo    # build and serve the demo at http://localhost:8080/demo/
```

## License

The cytoscape-libavoid source code is licensed under the [MIT License](LICENSE).

libavoid and libavoid-js are licensed under LGPL-2.1-or-later. The bundles in
`dist/` include libavoid-js, so the LGPL obligations apply when you ship them.
See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) and the (German)
license notes in [docs/LIZENZ.md](docs/LIZENZ.md).
