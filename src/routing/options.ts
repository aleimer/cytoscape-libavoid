// The options of EdgeRouter, shared by the plugin and the worker.

import { checkNonNegative, pluginError } from '../shared/errors';
import { ROUTING_OPTION_NAMES, ROUTING_PARAMETER_NAMES } from '../libavoid/api';
import type { RoutingOptionName, RoutingParameterName } from '../libavoid/api';

export interface RoutingOptions {
  /** Gap between neighbouring parallel edges (px). @default 2 */
  edgeSpacing: number;
  /** Clearance kept around nodes (px). @default 12 */
  shapeBufferDistance: number;
  /** Distance between parallel segments (px); `'auto'` = widest edge + `edgeSpacing`. @default 'auto' */
  idealNudgingDistance: number | 'auto';
  /** Spread apart edge ends that share a pin in the middle of a node side. @default true */
  nudgeConnectedSegments: boolean;
  /**
   * Spread apart parallel segments that libavoid leaves on top of each other, e.g.
   * where many edges share a narrow gap between nodes or end at the same pin
   * (see postprocess/).
   * @default true
   */
  separateOverlaps: boolean;
  /**
   * Where more edges share a narrow gap between nodes than fit into it, route the
   * ones passing through over a long distance through the nearest wider gap
   * instead (a second libavoid run, kept only if it overlaps less).
   * @default true
   */
  detourCrowded: boolean;
  /** Raw libavoid routing parameters, e.g. `{ crossingPenalty: 200 }`. @default {} */
  routingParameters: Partial<Record<RoutingParameterName, number>>;
  /**
   * Raw libavoid routing options, e.g. `{ nudgeSharedPathsWithCommonEndPoint: true }`.
   * `performUnifyingNudgingPreprocessingStep` is off unless set here, because it is very slow.
   * @default {}
   */
  routingOptions: Partial<Record<RoutingOptionName, boolean>>;
}

export const defaultRoutingOptions: Readonly<RoutingOptions> = Object.freeze({
  edgeSpacing: 2,
  shapeBufferDistance: 12,
  idealNudgingDistance: 'auto',
  nudgeConnectedSegments: true,
  separateOverlaps: true,
  detourCrowded: true,
  routingParameters: Object.freeze({}),
  routingOptions: Object.freeze({}),
});

/** Only the routing options of a larger options object, e.g. to send them to a worker. */
export function pickRoutingOptions(options: RoutingOptions): RoutingOptions {
  const picked: Partial<Record<keyof RoutingOptions, unknown>> = {};
  for (const key of Object.keys(defaultRoutingOptions) as Array<keyof RoutingOptions>) picked[key] = options[key];
  return picked as RoutingOptions;
}

/**
 * Merges options onto the defaults, checks the routing options and freezes the
 * result. The nested objects are copied, so they are never shared.
 */
export function resolveRoutingOptions<T extends RoutingOptions>(
  defaults: Readonly<T>,
  options: Partial<T>,
): Readonly<T> {
  // the defaults set both nested objects, so the merged ones are never undefined
  const merged: T = { ...defaults, ...options };
  merged.routingParameters = Object.freeze({ ...merged.routingParameters }) as T['routingParameters'];
  merged.routingOptions = Object.freeze({ ...merged.routingOptions }) as T['routingOptions'];
  checkRoutingOptions(merged);
  return Object.freeze(merged);
}

function checkRoutingOptions(options: RoutingOptions): void {
  checkNonNegative('edgeSpacing', options.edgeSpacing);
  checkNonNegative('shapeBufferDistance', options.shapeBufferDistance);
  if (options.idealNudgingDistance !== 'auto') checkNonNegative('idealNudgingDistance', options.idealNudgingDistance);
  for (const [name, value] of Object.entries(options.routingParameters)) {
    if (!isOneOf(name, ROUTING_PARAMETER_NAMES)) throw pluginError(`unknown routing parameter "${name}"`);
    if (value !== undefined && !Number.isFinite(value)) {
      throw pluginError(`routing parameter "${name}" must be a number`);
    }
  }
  for (const [name, value] of Object.entries(options.routingOptions)) {
    if (!isOneOf(name, ROUTING_OPTION_NAMES)) throw pluginError(`unknown routing option "${name}"`);
    if (value !== undefined && typeof value !== 'boolean') {
      throw pluginError(`routing option "${name}" must be a boolean`);
    }
  }
}

const isOneOf = (name: string, names: readonly string[]): boolean => names.includes(name);
