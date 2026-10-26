# cytoscape bench (Angular)

An Angular 22 app that runs cytoscape-libavoid together with the plugins used in
production (cytoscape-grid-guide, cytoscape-expand-collapse, cytoscape-node-html-label
with SVG node cards) on a material-flow graph, plus a runner that benchmarks it
in headless Chrome.

## Setup

```bash
npm install
npm run lib    # copies ../../src to src/app/cytoscape-libavoid/
```

The plugin is used the same way as in any other code base: its TypeScript
sources are copied into the app and compiled by the Angular build, and
`libavoid.wasm` is served from `node_modules/libavoid-js/dist` (see
`angular.json`). `npm start` and `npm run build` run `npm run lib` first, so
changes to `../../src` are picked up automatically. The copy is not checked in.
It is copied rather than imported from `../../src`, because that would
resolve a second copy of cytoscape from the repo's `node_modules` and break the typings.

## Run the benchmark

```bash
npm run bench                                # full matrix in bench.matrix.json
npm run bench -- --only "all, docking"       # runs whose name contains the text
npm run bench -- --zones zone --throttle 4   # zone mode only, CPU slowed down 4x
npm run bench -- --no-build --headed         # skip ng build, show the browser
```

Results are written to `results/<timestamp>.md` and `.json`.

## Try it by hand

```bash
npm start   # http://localhost:4200/?size=M&zone=zone&plugins=libavoid,gridGuide,expandCollapse,htmlLabel&ports=docking
```

The toolbar switches the configuration (it reloads the page) and runs single
scenarios; results appear below the graph.

## What is measured

| | |
|---|---|
| Config | graph size `S`/`M`/`L`; zone mode; enabled plugins; libavoid `ports`, `rerouteOnDrag` and `dragRouteInterval` |
| Zone modes | `zone`: zone.js, cytoscape created inside the Angular zone (what most apps do); `zone-outside`: zone.js with `NgZone.runOutsideAngular`; `zoneless` |
| Scenarios | `idle` 3 s · `drag` a node for 1.5 s with mouse events · `panzoom` 90 frames · `data` 10 live data updates of all nodes · `addRemove` 20 nodes + edges · `collapseExpand` all groups |
| Metrics | CPU % and main-thread task / script ms (DevTools protocol), fps and p95 frame time, long tasks, libavoid runs and routing ms, Angular change detection ticks |

The plugin setup is in [src/app/plugins.ts](src/app/plugins.ts) and the
scenarios are in [src/app/scenarios.ts](src/app/scenarios.ts). Change the plugin
options there to match the real app.
