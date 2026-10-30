// The options of `cy.libavoid()` and their defaults.

import type { EdgeSingular } from 'cytoscape';
import type { Avoid } from '../libavoid/api';
import type { Side } from '../shared/geometry';
import { checkNonNegative, checkOneOf, pluginError } from '../shared/errors';
import { defaultRoutingOptions, resolveRoutingOptions } from '../routing/options';
import type { RoutingOptions } from '../routing/options';
import type { RoutingWorker } from '../worker/messages';
import type { EdgeStyleOptions } from './route-style';

/**
 * The options after the defaults are applied. `cy.libavoid()` and `setOptions()`
 * take any part of them; only the fields marked `?` have no default.
 */
export interface LibavoidOptions extends RoutingOptions {
  /** URL of libavoid.wasm as served by the app. Not needed in Node.js. Only the first load uses it. */
  wasmUrl?: string | undefined;
  /** An already loaded libavoid instance (`AvoidLib.getInstance()`); skips loading. Not used with `worker`. */
  avoidLib?: Avoid | undefined;
  /**
   * Route in this Web Worker (running routing.worker.ts) instead of the main thread,
   * so large graphs do not block rendering. The plugin does not terminate it.
   */
  worker?: RoutingWorker | undefined;
  /** Selector of the edges to route. @default 'edge' */
  edges: string;
  /**
   * Selector of the nodes that act as obstacles. Edges to other visible nodes, e.g.
   * compound nodes, are routed too: they end in the middle of the side facing their
   * other end, and other edges may cross these nodes. Edges between a compound node
   * and a node inside it are not routed.
   * @default 'node:childless'
   */
  obstacles: string;
  /** Count node labels as part of the obstacle. @default false */
  includeLabels: boolean;
  /**
   * Stroke width of an edge (px), used to space parallel segments. The default reads
   * the drawn `width` style, so routing spaces edges as they are drawn.
   * @default the `width` style
   */
  edgeWidth: (edge: EdgeSingular) => number;
  /**
   * The sides of its nodes an edge may leave from (`source`) and end at (`target`): one
   * side or a list, missing = all four. E.g. a flow from left to right:
   * `edge => ({ source: 'right', target: 'left' })`. Read again whenever the graph changes.
   */
  edgeSides?: ((edge: EdgeSingular) => EdgeSides | undefined) | undefined;
  /** 0 = sharp corners, > 0 = rounded corners with this radius (px). @default 0 */
  cornerRadius: number;
  /**
   * `'middle'`: Cytoscape's label position, on routes with an odd number of bends a corner.
   * `'longest-segment'`: the centre of the longest segment (a horizontal one if it is at
   * least half as long); this replaces the edges' `text-margin-x` / `-y`.
   * @default 'middle'
   */
  labelPosition: EdgeStyleOptions['labelPosition'];
  /** Re-route automatically when elements are added, removed, moved or changed. @default true */
  live: boolean;
  /** With `live`: re-route continuously while a node is dragged; false = only on release. @default true */
  rerouteOnDrag: boolean;
  /**
   * With `rerouteOnDrag`: minimum pause between re-routes while a node is dragged (ms).
   * `'auto'` = as long as the last run kept the main thread busy, so routing uses at
   * most about half of it and dragging stays smooth on large graphs (with a `worker`:
   * no pause, the next run starts when the worker is done). 0 = re-route on every frame.
   * @default 'auto'
   */
  dragRouteInterval: number | 'auto';
  /**
   * With `rerouteOnDrag`: re-route only once the dragged nodes have rested this long (ms),
   * instead of while they move. 0 = off. The release always routes at once.
   * @default 0
   */
  dragRouteDelay: number;
  /**
   * Hide the edges of dragged nodes (`line-opacity` and `text-opacity` 0) from the
   * moment they move until a route for their new position is applied, instead of
   * showing stale routes. Best combined with `dragRouteDelay` or `rerouteOnDrag: false`.
   * Bypasses of these two properties set by the app come back when the edges are
   * shown; ones set while they are hidden are lost.
   * @default false
   */
  hideEdgesOnDrag: boolean;
}

/** Result of the `edgeSides` option. */
export interface EdgeSides {
  /** The side(s) of the source node the edge may leave from; missing = all four. */
  source?: Side | readonly Side[] | undefined;
  /** The side(s) of the target node the edge may end at; missing = all four. */
  target?: Side | readonly Side[] | undefined;
}

/** Payload of the `avoidrouted` event. */
export interface RoutedEventInfo {
  /** Number of routed edges. */
  edges: number;
  /** How long routing took (ms): libavoid plus the post-processing, in this thread or the worker. */
  routingMs: number;
  /** From the start of the run to the styled edges; with a worker incl. the round trip. */
  totalMs: number;
}

/** The defaults of LibavoidOptions, frozen; `cy.libavoid(options)` merges `options` onto them. */
export const defaults: Readonly<LibavoidOptions> = Object.freeze({
  ...defaultRoutingOptions,
  edges: 'edge',
  obstacles: 'node:childless',
  includeLabels: false,
  edgeWidth: (edge: EdgeSingular) => Number(edge.numericStyle('width')),
  cornerRadius: 0,
  labelPosition: 'middle',
  live: true,
  rerouteOnDrag: true,
  dragRouteInterval: 'auto',
  dragRouteDelay: 0,
  hideEdgesOnDrag: false,
});

/** Merges options onto the defaults, checks them and freezes the result; invalid options throw. */
export function resolveOptions(options: Partial<LibavoidOptions>): Readonly<LibavoidOptions> {
  const resolved = resolveRoutingOptions(defaults, options);
  checkNonNegative('cornerRadius', resolved.cornerRadius);
  checkNonNegative('dragRouteDelay', resolved.dragRouteDelay);
  if (resolved.dragRouteInterval !== 'auto') checkNonNegative('dragRouteInterval', resolved.dragRouteInterval);
  checkOneOf('labelPosition', resolved.labelPosition, ['middle', 'longest-segment']);
  for (const name of ['edges', 'obstacles'] as const) {
    if (typeof resolved[name] !== 'string') throw pluginError(`option ${name} must be a selector string`);
  }
  if (typeof resolved.edgeWidth !== 'function') throw pluginError('option edgeWidth must be a function');
  if (resolved.edgeSides !== undefined && typeof resolved.edgeSides !== 'function') {
    throw pluginError('option edgeSides must be a function');
  }
  return resolved;
}
