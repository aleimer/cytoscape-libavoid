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

### New

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

### Performance

Angular bench, 128 nodes / 182 edges, docking ports, dragging a node:

| | fps | main-thread script |
|---|--:|--:|
| 0.1.0 (re-route every frame) | 22 | 7230 ms |
| `dragRouteInterval: 'auto'` | 107 | 1278 ms |
| with `worker` | 168 | 697 ms |

With the production plugin mix (grid-guide, expand-collapse, node-html-label)
on the same graph, dragging went from 18.8 fps (0.1.0) to 42.5 fps, and to
70.4 fps with `worker` – close to the 74.2 fps of those plugins without
libavoid.

## 0.1.0

First version: npm package with ESM, UMD and standalone builds.
