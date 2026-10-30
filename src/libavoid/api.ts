// The part of the libavoid-js API used by this package. The typings shipped
// with libavoid-js are incomplete (no RouterFlag, no delete() on most classes)
// and fall back to `any`, so the module is cast to these types in load.ts.

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

export type RoutingParameterName = (typeof ROUTING_PARAMETER_NAMES)[number];

/** libavoid's RoutingOption names. */
export const ROUTING_OPTION_NAMES = [
  'nudgeOrthogonalSegmentsConnectedToShapes',
  'improveHyperedgeRoutesMovingJunctions',
  'penaliseOrthogonalSharedPathsAtConnEnds',
  'nudgeOrthogonalTouchingColinearSegments',
  'performUnifyingNudgingPreprocessingStep',
  'improveHyperedgeRoutesMovingAddingAndDeletingJunctions',
  'nudgeSharedPathsWithCommonEndPoint',
] as const;

export type RoutingOptionName = (typeof ROUTING_OPTION_NAMES)[number];

/** Any object in WebAssembly memory that must be freed explicitly. */
export interface Deletable {
  delete(): void;
}

/** Value of a C++ enum exposed by libavoid-js. */
export interface EnumValue {
  readonly value: number;
}

export interface AvoidPoint extends Point, Deletable {}
export interface Rectangle extends Deletable {}
export interface ConnEnd extends Deletable {}

export interface Router extends Deletable {
  processTransaction(): void;
  setRoutingParameter(parameter: EnumValue, value: number): void;
  setRoutingOption(option: EnumValue, value: boolean): void;
}

/** An obstacle; owned and freed by its router. */
export interface ShapeRef {
  id(): number;
}

/** A point on a shape's border that connectors attach to; owned and freed by its shape. */
export interface ShapeConnectionPin {
  setExclusive(exclusive: boolean): void;
}

/** A copy of a route (embind copies returned references), so it must be freed. */
export interface PolyLine extends Deletable {
  size(): number;
  /** Also a copy that must be freed. */
  at(index: number): AvoidPoint;
}

/** A routed connection between two shapes; owned and freed by its router. */
export interface ConnRef {
  displayRoute(): PolyLine;
  setRoutingCheckpoints(checkpoints: CheckpointVector): void;
}

export interface Checkpoint extends Deletable {}

/** libavoid copies the checkpoints, so the vector can be freed after use. */
export interface CheckpointVector extends Deletable {
  push_back(checkpoint: Checkpoint): void;
}

/** An initialised libavoid instance, as returned by `AvoidLib.getInstance()`. */
export interface Avoid {
  Point: new (x: number, y: number) => AvoidPoint;
  Rectangle: new (centre: AvoidPoint, width: number, height: number) => Rectangle;
  Router: new (flags: number) => Router;
  ShapeRef: new (router: Router, polygon: Rectangle) => ShapeRef;
  ShapeConnectionPin: new (
    shape: ShapeRef,
    classId: number,
    xOffset: number,
    yOffset: number,
    proportional: boolean,
    insideOffset: number,
    visibleDirections: number,
  ) => ShapeConnectionPin;
  ConnEnd: {
    new (shape: ShapeRef, pinClassId: number): ConnEnd;
    new (point: AvoidPoint): ConnEnd;
  };
  ConnRef: new (router: Router, source: ConnEnd, target: ConnEnd) => ConnRef;
  Checkpoint: new (point: AvoidPoint) => Checkpoint;
  CheckpointVector: new () => CheckpointVector;
  RouterFlag: { readonly OrthogonalRouting: EnumValue };
  // Indexed by arbitrary strings because names come from user options at runtime.
  RoutingParameter: { readonly [name: string]: EnumValue | undefined };
  RoutingOption: { readonly [name: string]: EnumValue | undefined };
}
