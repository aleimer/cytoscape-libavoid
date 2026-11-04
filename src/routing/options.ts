/**
 * The options of EdgeRouter. They are plain data, so they can be posted to a worker.
 */

import { ROUTING_OPTION_NAMES, ROUTING_PARAMETER_NAMES } from '../libavoid/api';
import type { RoutingOptionName, RoutingParameterName } from '../libavoid/api';
import { checkNonNegative, pluginError } from '../shared/errors';

/**
 * The routing settings the plugin interprets: some it hands to libavoid (e.g.
 * `shapeBufferDistance`), the rest drive the post-processing (separation, detours).
 */
export interface PluginRoutingOptions
{
  /** Gap between neighbouring parallel edges (px). @default 2 */
  edgeSpacing: number;
  /** Distance edges keep from the nodes they pass (px); libavoid's parameter of the same name. @default 12 */
  shapeBufferDistance: number;
  /**
   * Distance between parallel segments (px); libavoid's parameter of the same name.
   * `'auto'` = widest edge + `edgeSpacing`, at least 4.
   * @default 'auto'
   */
  idealNudgingDistance: number | 'auto';
  /**
   * Spread apart edge ends that share a pin in the centre of a node side; libavoid's
   * option `nudgeOrthogonalSegmentsConnectedToShapes`.
   * @default true
   */
  nudgeConnectedSegments: boolean;
  /**
   * Spread apart parallel segments that libavoid leaves on top of each other, e.g.
   * where many edges share a narrow gap between nodes or end at the same pin
   * (see `separateOverlaps()` in postprocess/overlap-separator.ts).
   * @default true
   */
  separateOverlaps: boolean;
  /**
   * Where more edges pass between two nodes than fit there, route the ones passing
   * through over a long distance around it, through the nearest wider gap between
   * nodes (a second libavoid run, kept only if it overlaps less).
   * @default true
   */
  detourCrowdedAreas: boolean;
}

/**
 * libavoid's own settings by their libavoid names, passed through unchanged. They
 * only tune libavoid's routing step, not the post-processing, and win over the
 * values the plugin derives from {@link PluginRoutingOptions}. Unknown names throw.
 */
export interface RawLibavoidOptions
{
  /**
   * libavoid RoutingParameters (numbers), e.g. `{ crossingPenalty: 200 }`. A name
   * left out keeps libavoid's default, except the two the plugin sets itself.
   *
   * - `segmentPenalty`: cost of every segment after the first; fewer bends.
   * - `anglePenalty`: cost of bends that are not right angles (not used for orthogonal routes).
   * - `crossingPenalty`: cost of crossing another edge; fewer crossings, longer routes.
   * - `clusterCrossingPenalty`: cost of crossing a cluster boundary (the plugin uses no clusters).
   * - `fixedSharedPathPenalty`: cost of sharing a path with an edge whose route is fixed.
   * - `portDirectionPenalty`: cost of leaving a pin in a direction other than the one it faces.
   * - `shapeBufferDistance`: set by the plugin from `shapeBufferDistance`.
   * - `idealNudgingDistance`: set by the plugin from `idealNudgingDistance`.
   * - `reverseDirectionPenalty`: cost of a route heading away from its target.
   *
   * @default {}
   */
  routingParameters: Partial<Record<RoutingParameterName, number>>;
  /**
   * libavoid RoutingOptions (on / off), e.g. `{ nudgeSharedPathsWithCommonEndPoint: false }`.
   * A name left out keeps libavoid's default, except the two the plugin sets itself.
   *
   * - `nudgeOrthogonalSegmentsConnectedToShapes`: set by the plugin from `nudgeConnectedSegments`.
   * - `improveHyperedgeRoutesMovingJunctions`: hyperedges only (not used by the plugin); libavoid: on.
   * - `penaliseOrthogonalSharedPathsAtConnEnds`: avoid shared paths next to edge ends; libavoid: off.
   * - `nudgeOrthogonalTouchingColinearSegments`: also spread apart segments that only touch end to end; libavoid: off.
   * - `performUnifyingNudgingPreprocessingStep`: set **off** by the plugin; on in libavoid, but it
   *   takes ~98 % of the routing time for slightly fewer bends.
   * - `improveHyperedgeRoutesMovingAddingAndDeletingJunctions`: hyperedges only; libavoid: off.
   * - `nudgeSharedPathsWithCommonEndPoint`: spread apart edges that share a path and an end; libavoid: on.
   *
   * @default {}
   */
  routingOptions: Partial<Record<RoutingOptionName, boolean>>;
}

/** All options of EdgeRouter: the plugin's own and libavoid's raw ones. */
export type RoutingOptions = PluginRoutingOptions & RawLibavoidOptions;

/** The defaults of {@link RoutingOptions}, frozen. */
export const DEFAULT_ROUTING_OPTIONS: Readonly<RoutingOptions> = Object.freeze({
  edgeSpacing: 2,
  shapeBufferDistance: 12,
  idealNudgingDistance: 'auto',
  nudgeConnectedSegments: true,
  separateOverlaps: true,
  detourCrowdedAreas: true,
  routingParameters: Object.freeze({}),
  routingOptions: Object.freeze({}),
});

/**
 * Only the routing options of a larger options object, e.g. to send them to a
 * worker, where functions such as `edgeWidth` cannot be posted.
 *
 * @param options any object with all routing options, e.g. the plugin's options
 * @returns a new object with only the keys of {@link DEFAULT_ROUTING_OPTIONS}
 */
export function pickRoutingOptions(options: RoutingOptions): RoutingOptions
{
  const picked: Partial<Record<keyof RoutingOptions, unknown>> = {};
  for (const key of Object.keys(DEFAULT_ROUTING_OPTIONS) as Array<keyof RoutingOptions>)
  {
    picked[key] = options[key];
  }
  return picked as RoutingOptions;
}

/**
 * Merges options onto the defaults, checks the routing options and freezes the
 * result. The nested objects are copied, so they are never shared.
 *
 * @param defaults the complete defaults, e.g. {@link DEFAULT_ROUTING_OPTIONS}
 * @param options  the values to change
 * @returns the merged options, frozen
 * @throws {Error} for invalid values and unknown libavoid names
 */
export function resolveRoutingOptions<T extends RoutingOptions>(
  defaults: Readonly<T>,
  options: Partial<T>,
): Readonly<T>
{
  // the defaults set both nested objects, so the merged ones are never undefined
  const merged: T = { ...defaults, ...options };
  merged.routingParameters = Object.freeze({ ...merged.routingParameters }) as T['routingParameters'];
  merged.routingOptions = Object.freeze({ ...merged.routingOptions }) as T['routingOptions'];
  checkPluginRoutingOptions(merged);
  checkRawLibavoidOptions(merged);
  return Object.freeze(merged);
}

/**
 * Checks the values of the plugin's own routing options.
 *
 * @param options the merged options
 * @throws {Error} for negative or non-numeric distances
 */
function checkPluginRoutingOptions(options: PluginRoutingOptions): void
{
  checkNonNegative('edgeSpacing', options.edgeSpacing);
  checkNonNegative('shapeBufferDistance', options.shapeBufferDistance);
  if (options.idealNudgingDistance !== 'auto')
  {
    checkNonNegative('idealNudgingDistance', options.idealNudgingDistance);
  }
}

/**
 * Checks the names and values of libavoid's raw options. Without the check, unknown
 * names would only fail once libavoid is loaded and a run starts.
 *
 * @param options the merged options
 * @throws {Error} for names libavoid does not know and values of the wrong type
 */
function checkRawLibavoidOptions(options: RawLibavoidOptions): void
{
  for (const [name, value] of Object.entries(options.routingParameters))
  {
    if (!isOneOf(name, ROUTING_PARAMETER_NAMES))
    {
      throw pluginError(`unknown routing parameter "${name}"`);
    }
    if (value !== undefined && !Number.isFinite(value))
    {
      throw pluginError(`routing parameter "${name}" must be a number`);
    }
  }
  for (const [name, value] of Object.entries(options.routingOptions))
  {
    if (!isOneOf(name, ROUTING_OPTION_NAMES))
    {
      throw pluginError(`unknown routing option "${name}"`);
    }
    if (value !== undefined && typeof value !== 'boolean')
    {
      throw pluginError(`routing option "${name}" must be a boolean`);
    }
  }
}

/**
 * Whether a name is in a list of names.
 *
 * @param name  the name to look for
 * @param names e.g. {@link ROUTING_PARAMETER_NAMES}
 * @returns true if `names` contains `name`
 */
const isOneOf = (name: string, names: readonly string[]): boolean => names.includes(name);
