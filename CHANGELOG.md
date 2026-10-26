# Changelog

## Unreleased

### Breaking changes

For code that used 0.1.0:

| 0.1.0 | now |
|---|---|
| `npm install` of the package, `import … from 'cytoscape-libavoid'` | copy `src/` into the project, `import … from './cytoscape-libavoid'`; see [src/README.md](src/README.md) |
| UMD build (`<script>`), standalone build with inlined wasm, `dist/`, `lib/` | removed; serve `node_modules/libavoid-js/dist/libavoid.wasm` and pass `wasmUrl` |
| `ports: 'sankey'` | `ports: 'docking'` |
| `computeSankeyPorts()`, `SankeyPort`, `SankeyPorts` | `computeDockingPorts()`, `DockingPort`, `EdgePorts` |
| `routeGraph(avoid, model, options)` | `new EdgeRouter(avoid, options).route(model)` |
| graph model nodes `{ w, h }` | `{ width, height }` |
| `routing.routes` / `styled` / `Avoid` / `destroyed` writable | `routes` is a read-only getter, the rest is private |
| `defaults` mutable | frozen; instances no longer share `routingParameters` / `routingOptions` with it |
| `register(undefined)` was a no-op | `register(cytoscape)` needs Cytoscape |
| `routeToEdgeStyle(points, source, target, cornerRadius)` | `routeToEdgeStyle(points, source, target, { cornerRadius, labelPosition })` |
| routes could lie on top of each other | `separateOverlaps` and `detourCrowded` are on by default (orthogonal routing); a full run takes about twice as long, see below |

### New

- **no more edges on top of each other**: `detourCrowded` sends edges that do
  not fit into a narrow gap between nodes through the nearest wider one (a
  second libavoid run), `separateOverlaps` spreads the remaining overlapping
  segments apart by their widths; `routeQuality()` and `npm run quality`
  measure overlaps, crossings, bends and length
- `flowDirection: 'auto'`: docking edges use the sides their nodes face, so
  edges against the main flow no longer loop around their nodes
- `labelPosition: 'longest-segment'`: edge labels on the centre of the longest
  segment instead of a corner
- `worker` option: route in a Web Worker (`src/routing.worker.ts`), so large
  graphs do not block the page; `refresh()` as the asynchronous `route()`;
  `WorkerRouter` for using a worker without Cytoscape
- `dragRouteInterval` (default `'auto'`): spaces out re-routes while dragging
  so routing takes at most about half of the time
- `avoiderror` event for failed automatic re-routes (also logged); the plugin
  keeps running
- one class per file: `LibavoidRouting` (wrapper), `EdgeRouter` (routing),
  `LibavoidRouter` (libavoid connector), `EdgeStyler` (edge styles); option
  docs as JSDoc on the types
- the sources compile with every TypeScript strictness flag, the ES2020
  library and TypeScript 5.0+ (`tsconfig.strict.json`)

### Fixed

- WebAssembly memory leak: route and point copies returned by libavoid were
  never freed (the heap grew by ~20 MB per 1200 runs of a 45-node graph)
- docking ports on top / bottom sides (via `sourceSide` / `targetSide`) were
  ordered by the wrong axis, so edges crossed right at the node
- `rerouteOnDrag: false` also holds back the re-routes from the style events
  a drag fires in compound graphs
- `cy.destroy()` ends the routing, so pending re-routes no longer touch the
  destroyed graph

### Route quality

Bench graph with 128 nodes / 182 edges (`npm run quality`):

| | overlapping strokes | crossings |
|---|--:|--:|
| auto ports, 0.1.0 | 61,940 px | 1310 |
| auto ports, now | 6,175 px | 1348 |
| docking ports, 0.1.0 | 63,892 px | 1047 |
| docking ports, now | 20,111 px | 1205 |

### Performance

A full run with detours takes about twice as long as libavoid alone (128
nodes: ~200 ms instead of ~80 ms). Drags route drafts without detours and
route once more in full on release; with `worker` it stays off the main
thread.

Angular bench, 128 nodes / 182 edges, docking ports, dragging a node
(incl. separating overlaps and the full run with detours on release):

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
