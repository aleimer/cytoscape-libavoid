# Changelog

## Unreleased

### Breaking changes

For code that used 0.1.0:

| 0.1.0 | now |
|---|---|
| `npm install` of the package, `import … from 'cytoscape-libavoid'` | copy `src/` into the project, `import … from './cytoscape-libavoid'`; see [src/README.md](src/README.md) |
| UMD build (`<script>`), standalone build with inlined wasm, `dist/`, `lib/` | removed; serve `node_modules/libavoid-js/dist/libavoid.wasm` and pass `wasmUrl` |
| `ports`, `flowDirection`, `data(sourceSide)` / `data(targetSide)` | removed: every edge attaches to the pins in the middle of the node sides and libavoid picks the side (as `ports: 'auto'` did); the per-edge ports overlapped and routed wrongly |
| `computeSankeyPorts()`, `SankeyPort`, `SankeyPorts`, `spreadPorts()` | removed |
| `nudgeConnectedSegments: 'auto'` | `nudgeConnectedSegments: true` (a boolean) |
| `portSpacing` | `edgeSpacing`: the gap between parallel edges, there are no ports to space any more |
| `LibavoidRouter.addPin(shape, { classId, side, offset, exclusive })`, type `PinSpec` | `addPin(shape, classId, side)`: always a shared pin in the middle of the side |
| imports from `src/routing`, `src/separation`, `src/libavoid`, `src/edge-style` | import from `src` (`index.ts`); the sources are now in the folders `shared/`, `cytoscape-adapter/`, `routing/`, `postprocess/`, `libavoid/` and `worker/` |
| `EdgeStyler`, `LibavoidRouter`, `routeToEdgeStyle`, `edgeStyleToPoints`, `labelOffset`, `separateOverlaps`, `findDetours`, `simplify`, `answerRouteRequest` exported from `index.ts` | not part of the public API any more; import them from their files. `LibavoidRouter` is now `LibavoidSession` (`libavoid/libavoid-session.ts`), the route ↔ style functions are in `cytoscape-adapter/route-style.ts` |
| `routing.route()` (synchronous, not with a worker) | `await routing.refresh()`, with and without a worker |
| `setOptions()` routed synchronously without a worker and threw routing errors | invalid options throw at once; it routes asynchronously and routing errors arrive as `avoiderror` |
| `routing.options` / `router.options` mutable | frozen and checked (e.g. negative distances, unknown libavoid names throw); change them with `setOptions()` |
| `new WorkerRouter(worker)`, `route({ model, options, wasmUrl })`, `WorkerRouteResult` | `new WorkerRouter(worker, wasmUrl)`, `route(model, options)`, `RouteResult` |
| `RouteAnalysis`, `QualityMeter`, `OverlapSeparator`, `DetourFinder` classes | `RouteGeometry` with `measureQuality()`, `separateOverlapsIn()`, `findDetoursIn()` |
| `model.ts` | `shared/geometry.ts` (`Point`, `Side`, …) and `shared/graph.ts` (`GraphModel`, …) |
| `routingType: 'polyline'`, the `RoutingType` type | removed: routes are always orthogonal; polyline routes were many times slower and not freed of overlaps |
| `routeGraph(avoid, model, options)` | `new EdgeRouter(avoid, options).route(model)` |
| graph model nodes `{ w, h }` | `{ width, height }` |
| `routing.routes` / `styled` / `Avoid` / `destroyed` writable | `routes` is a read-only getter, the rest is private |
| `defaults` mutable | frozen; instances no longer share `routingParameters` / `routingOptions` with it |
| `register(undefined)` was a no-op | `register(cytoscape)` needs Cytoscape |
| `routeToEdgeStyle(points, source, target, cornerRadius)` | `routeToEdgeStyle(points, source, target, { cornerRadius, labelPosition })` |
| routes could lie on top of each other | `separateOverlaps` and `detourCrowded` are on by default; a full run takes about twice as long, see below |

### New

- **no more edges on top of each other**: `detourCrowded` sends edges that do
  not fit into a narrow gap between nodes through the nearest wider one (a
  second libavoid run), `separateOverlaps` spreads the remaining overlapping
  segments apart by their widths, edges into the same node side fanned out
  along it; `routeQuality()` and `npm run quality`
  measure overlaps, crossings, bends and length
- `labelPosition: 'longest-segment'`: edge labels on the centre of the longest
  segment instead of a corner
- `worker` option: route in a Web Worker (`src/routing.worker.ts`), so large
  graphs do not block the page; `refresh()` as the asynchronous `route()`;
  `WorkerRouter` for using a worker without Cytoscape
- `dragRouteInterval` (default `'auto'`): spaces out re-routes while dragging
  so routing takes at most about half of the time
- edges to compound nodes (and other nodes that are no `obstacles`) are
  routed: they end on the side facing their other end (`GraphNode.obstacle: false`)
- `edgeSides`: allowed sides per edge end (`GraphEdge.sourceSides` /
  `targetSides` in the model)
- `RoutingBackend`: the plugin routes through one interface, implemented by
  `LocalRouter` (this thread) and `WorkerRouter`
- `npm run lint` (oxlint), `npm run deps:check` (layering rules),
  `npm run test:e2e` (drags nodes in Chrome)
- `dragRouteDelay`: while dragging, re-route only once the nodes rest;
  `hideEdgesOnDrag`: hide the edges of dragged nodes until they are routed
  for the new position
- `avoiderror` event for failed automatic re-routes (also logged); the plugin
  keeps running
- one class per file: `LibavoidRouting` (wrapper), `EdgeRouter` (routing),
  `LibavoidSession` (libavoid connector), `EdgeStyler` (edge styles); option
  docs as JSDoc on the types
- the sources compile with every TypeScript strictness flag, the ES2020
  library and TypeScript 5.0+ (`tsconfig.strict.json`)

### Fixed

- WebAssembly memory leak: route and point copies returned by libavoid were
  never freed (the heap grew by ~20 MB per 1200 runs of a 45-node graph)
- `rerouteOnDrag: false` also holds back the re-routes from the style events
  a drag fires in compound graphs
- `cy.destroy()` ends the routing, so pending re-routes no longer touch the
  destroyed graph

### Route quality

Bench graph with 128 nodes / 182 edges (`npm run quality`):

| | overlapping strokes | crossings |
|---|--:|--:|
| 0.1.0 (`ports: 'auto'`) | 61,940 px | 1310 |
| now | 6,157 px | 1355 |

Where more than two edges end at one node side, the thickest one now ends at
the centre of the side; the others keep their order around it. This adds a
few crossings next to such nodes.

### Performance

A full run with detours takes about twice as long as libavoid alone (128
nodes: ~130 ms instead of ~50 ms). Drags route drafts without detours and
route once more in full on release; with `worker` it stays off the main
thread.

Angular bench, 128 nodes / 182 edges, dragging a node (incl. separating
overlaps and the full run with detours on release; measured with the since
removed docking ports):

| | fps | main-thread script |
|---|--:|--:|
| re-route every frame (as in 0.1.0) | 16 | 9874 ms |
| `dragRouteInterval: 'auto'` | 87 | 1532 ms |
| with `worker` | 175 | 721 ms |

With the production plugin mix (grid-guide, expand-collapse, node-html-label)
on the same graph, dragging went from 18.8 fps (0.1.0) to 35.5 fps, and to
73.7 fps with `worker` – about the 74 fps of those plugins without libavoid.

## 0.1.0

First version: npm package with ESM, UMD and standalone builds.
