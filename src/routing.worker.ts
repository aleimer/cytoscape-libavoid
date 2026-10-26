// Web Worker entry: routes graph models off the main thread, so large graphs
// do not block rendering. Create the worker in the app and pass it to the plugin:
//
//   const worker = new Worker(new URL('./cytoscape-libavoid/routing.worker', import.meta.url), { type: 'module' });
//   cy.libavoid({ worker, wasmUrl: 'libavoid.wasm' });

import { answerRouteRequest } from './routing';
import type { RouteRequest } from './routing';

addEventListener('message', (event: MessageEvent<RouteRequest>) => {
  void answerRouteRequest(event.data).then((response) => postMessage(response));
});
