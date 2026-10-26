# cytoscape-libavoid (TypeScript sources)

The plugin as plain TypeScript, compiled by your own project's toolchain.

## 1. Copy and install

Copy this folder into your code base, e.g. `src/app/cytoscape-libavoid/`, then:

```sh
npm install cytoscape libavoid-js
npm install -D @types/cytoscape   # only for cytoscape < 3.31, newer versions ship their own types
```

Requirements: `moduleResolution: "bundler"` (or `"node"`) and `skipLibCheck: true`
(the default in Angular / Vite templates; libavoid-js ships broken `.d.ts` files).
The sources compile with every strictness flag on (incl. `exactOptionalPropertyTypes`
and `noUncheckedIndexedAccess`) and need no library newer than ES2020.

## 2. Serve libavoid.wasm

The WebAssembly file is loaded at runtime and must be served by your app.
Copy `node_modules/libavoid-js/dist/libavoid.wasm` into your static assets.

Angular (`angular.json` → `architect.build.options.assets`):

```json
{ "glob": "libavoid.wasm", "input": "node_modules/libavoid-js/dist", "output": "/" }
```

Vite / others: put a copy in `public/` (or your equivalent static folder).

## 3. Register and use

```ts
import cytoscape from 'cytoscape';
import cytoscapeLibavoid, { type RoutedEventInfo } from './cytoscape-libavoid';

cytoscape.use(cytoscapeLibavoid); // once, at startup

const cy = cytoscape({ container, elements, style });
const routing = cy.libavoid({
  wasmUrl: 'libavoid.wasm', // URL relative to the page, as served in step 2
  ports: 'docking', // or 'auto'
  flowDirection: 'right',
  cornerRadius: 8,
});
await routing.ready;

cy.on('avoidrouted', (_evt, info: RoutedEventInfo) => console.log(info.edges, info.routingMs));
routing.getRoute('edgeId'); // route points
routing.destroy(); // restore the edges' own styles
```

`cy.libavoid()` without options returns the current instance. All options are
documented on the `LibavoidOptions` type in `index.ts`; the defaults are in `defaults`.

## 4. Optional: route in a Web Worker

For large graphs (a few hundred nodes, where one run takes 100 ms or more) let
a worker do the routing, so the page stays responsive. `routing.worker.ts` is
the worker entry; Angular, Vite and webpack 5 bundle it from this pattern:

```ts
const worker = new Worker(new URL('./cytoscape-libavoid/routing.worker', import.meta.url), { type: 'module' });
const routing = cy.libavoid({ worker, wasmUrl: 'libavoid.wasm' });
await routing.ready;
await routing.refresh(); // instead of routing.route(), which is synchronous
```

The plugin does not terminate the worker; several instances may share one.
