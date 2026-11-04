/**
 * The part of the libavoid-js API used by this package. The typings shipped
 * with libavoid-js are incomplete (no RouterFlag, no delete() on most classes)
 * and fall back to `any`, so the module is cast to these types in load.ts.
 */

import type { Point } from '../shared/geometry';

/** libavoid's RoutingParameter names, so options can be checked before libavoid is loaded. */
export const ROUTING_PARAMETER_NAMES = [
  'segmentPenalty',
  'anglePenalty',
  'crossingPenalty',
  'clusterCrossingPenalty',
  'fixedSharedPathPenalty',
  'portDirectionPenalty',
  'shapeBufferDistance',
  'idealNudgingDistance',
  'reverseDirectionPenalty',
] as const;

/** One of {@link ROUTING_PARAMETER_NAMES}. */
export type RoutingParameterName = (typeof ROUTING_PARAMETER_NAMES)[number];

/** libavoid's RoutingOption names, so options can be checked before libavoid is loaded. */
export const ROUTING_OPTION_NAMES = [
  'nudgeOrthogonalSegmentsConnectedToShapes',
  'improveHyperedgeRoutesMovingJunctions',
  'penaliseOrthogonalSharedPathsAtConnEnds',
  'nudgeOrthogonalTouchingColinearSegments',
  'performUnifyingNudgingPreprocessingStep',
  'improveHyperedgeRoutesMovingAddingAndDeletingJunctions',
  'nudgeSharedPathsWithCommonEndPoint',
] as const;

/** One of {@link ROUTING_OPTION_NAMES}. */
export type RoutingOptionName = (typeof ROUTING_OPTION_NAMES)[number];

/** Any object in WebAssembly memory that must be freed explicitly. */
export interface Deletable
{
  /** Frees the object's WebAssembly memory; it cannot be used afterwards. */
  delete(): void;
}

/** Value of a C++ enum exposed by libavoid-js. */
export interface EnumValue
{
  /** The numeric value of the enum member. */
  readonly value: number;
}

/** A libavoid point; must be freed, see {@link Deletable}. */
export interface AvoidPoint extends Point, Deletable
{}
/** A libavoid rectangle, the outline of a shape; must be freed. */
export interface Rectangle extends Deletable
{}
/** One end of a connector: a pin class of a shape or a free point; must be freed. */
export interface ConnEnd extends Deletable
{}

/** Routes all connectors around all shapes it owns; freeing it frees them too. */
export interface Router extends Deletable
{
  /** Routes every connector that changed since the last call. */
  processTransaction(): void;
  /**
   * Sets a routing parameter, see {@link ROUTING_PARAMETER_NAMES}.
   *
   * @param parameter the enum value of the parameter
   * @param value     the new value
   */
  setRoutingParameter(parameter: EnumValue, value: number): void;
  /**
   * Switches a routing option on or off, see {@link ROUTING_OPTION_NAMES}.
   *
   * @param option the enum value of the option
   * @param value  on or off
   */
  setRoutingOption(option: EnumValue, value: boolean): void;
}

/** An obstacle; owned and freed by its router. */
export interface ShapeRef
{
  /** @returns the shape's id within its router */
  id(): number;
}

/** A point on a shape's border that connectors attach to; owned and freed by its shape. */
export interface ShapeConnectionPin
{
  /**
   * @param exclusive true: one connector per pin (libavoid's default); false: any number
   */
  setExclusive(exclusive: boolean): void;
}

/** A copy of a route (embind copies returned references), so it must be freed. */
export interface PolyLine extends Deletable
{
  /** @returns the number of points */
  size(): number;
  /**
   * @param index 0 to `size() - 1`
   * @returns a copy of the point, which must be freed as well
   */
  at(index: number): AvoidPoint;
}

/** A routed connection between two shapes; owned and freed by its router. */
export interface ConnRef
{
  /** @returns a copy of the route as displayed, from the source to the target end; must be freed */
  displayRoute(): PolyLine;
  /**
   * Makes the connector pass through these points, in order.
   *
   * @param checkpoints copied by libavoid, so they can be freed after the call
   */
  setRoutingCheckpoints(checkpoints: CheckpointVector): void;
}

/** A point a connector must pass through; must be freed. */
export interface Checkpoint extends Deletable
{}

/** libavoid copies the checkpoints, so the vector can be freed after use. */
export interface CheckpointVector extends Deletable
{
  /** @param checkpoint appended to the vector */
  push_back(checkpoint: Checkpoint): void;
}

/** An initialised libavoid instance, as returned by `AvoidLib.getInstance()`. */
export interface Avoid
{
  /** Creates a point (x, y). */
  Point: new(x: number, y: number) => AvoidPoint;
  /** Creates a rectangle of `width` x `height` around `centre`. */
  Rectangle: new(centre: AvoidPoint, width: number, height: number) => Rectangle;
  /** Creates a router; `flags` selects the kind of routes, see `RouterFlag`. */
  Router: new(flags: number) => Router;
  /** Adds a shape with this outline to the router. */
  ShapeRef: new(router: Router, polygon: Rectangle) => ShapeRef;
  /**
   * Adds a pin to a shape: `xOffset` / `yOffset` as fractions of its size if
   * `proportional`, `insideOffset` into the shape, `visibleDirections` the
   * ConnDirFlags a connector may leave it in.
   */
  ShapeConnectionPin: new(
    shape: ShapeRef,
    classId: number,
    xOffset: number,
    yOffset: number,
    proportional: boolean,
    insideOffset: number,
    visibleDirections: number,
  ) => ShapeConnectionPin;
  /** Creates a connector end at any pin of a class of a shape, or at a free point. */
  ConnEnd: {
    new(shape: ShapeRef, pinClassId: number): ConnEnd;
    new(point: AvoidPoint): ConnEnd;
  };
  /** Adds a connector between two ends to the router. */
  ConnRef: new(router: Router, source: ConnEnd, target: ConnEnd) => ConnRef;
  /** Creates a checkpoint at a point. */
  Checkpoint: new(point: AvoidPoint) => Checkpoint;
  /** Creates an empty list of checkpoints. */
  CheckpointVector: new() => CheckpointVector;
  /** The kinds of routes a router makes. */
  RouterFlag: { readonly OrthogonalRouting: EnumValue; };
  /** The routing parameters by name, see {@link ROUTING_PARAMETER_NAMES}; indexed by any string, as the names come from options. */
  RoutingParameter: { readonly [name: string]: EnumValue | undefined; };
  /** The routing options by name, see {@link ROUTING_OPTION_NAMES}; indexed by any string, as the names come from options. */
  RoutingOption: { readonly [name: string]: EnumValue | undefined; };
}
