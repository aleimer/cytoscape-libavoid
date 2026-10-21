// Types for the part of libavoid-js used by this package. The typings shipped
// with libavoid-js are incomplete (no RouterFlag, no delete() on most classes)
// and fall back to `any`, so tsconfig maps the module onto types/libavoid-js.d.ts.

export interface Point {
  x: number;
  y: number;
}

/** Any Emscripten-allocated object that must be freed explicitly. */
export interface Deletable {
  delete(): void;
}

/** Value of an Emscripten-bound C++ enum. */
export interface EnumValue {
  readonly value: number;
}

export interface AvoidPoint extends Point, Deletable {}
export interface Polygon extends Deletable {}
export interface Rectangle extends Polygon {}
export interface ConnEnd extends Deletable {}

export interface Router extends Deletable {
  processTransaction(): void;
  setRoutingParameter(parameter: EnumValue, value: number): void;
  setRoutingOption(option: EnumValue, value: boolean): void;
}

/** Owned and freed by its router. */
export interface ShapeRef {
  id(): number;
}

/** Owned and freed by its shape. */
export interface ShapeConnectionPin {
  setExclusive(exclusive: boolean): void;
}

export interface PolyLine {
  size(): number;
  at(index: number): Point;
}

/** Owned and freed by its router. */
export interface ConnRef {
  displayRoute(): PolyLine;
}

export type RoutingParameterName =
  | 'segmentPenalty'
  | 'anglePenalty'
  | 'crossingPenalty'
  | 'clusterCrossingPenalty'
  | 'fixedSharedPathPenalty'
  | 'portDirectionPenalty'
  | 'shapeBufferDistance'
  | 'idealNudgingDistance'
  | 'reverseDirectionPenalty';

export type RoutingOptionName =
  | 'nudgeOrthogonalSegmentsConnectedToShapes'
  | 'improveHyperedgeRoutesMovingJunctions'
  | 'penaliseOrthogonalSharedPathsAtConnEnds'
  | 'nudgeOrthogonalTouchingColinearSegments'
  | 'performUnifyingNudgingPreprocessingStep'
  | 'improveHyperedgeRoutesMovingAddingAndDeletingJunctions'
  | 'nudgeSharedPathsWithCommonEndPoint';

/** An initialised libavoid instance, as returned by `AvoidLib.getInstance()`. */
export interface Avoid {
  Point: new (x: number, y: number) => AvoidPoint;
  Rectangle: new (centre: AvoidPoint, width: number, height: number) => Rectangle;
  Router: new (flags: number) => Router;
  ShapeRef: new (router: Router, polygon: Polygon) => ShapeRef;
  ShapeConnectionPin: new (
    shape: ShapeRef,
    classId: number,
    xOffset: number,
    yOffset: number,
    proportional: boolean,
    insideOffset: number,
    visDirs: number,
  ) => ShapeConnectionPin;
  ConnEnd: new (shape: ShapeRef, classId: number) => ConnEnd;
  ConnRef: new (router: Router, source: ConnEnd, target: ConnEnd) => ConnRef;
  RouterFlag: { readonly PolyLineRouting: EnumValue; readonly OrthogonalRouting: EnumValue };
  // Indexed by arbitrary strings because names come from user options at runtime.
  RoutingParameter: { readonly [name: string]: EnumValue | undefined };
  RoutingOption: { readonly [name: string]: EnumValue | undefined };
}

export interface AvoidLibLoader {
  load(wasmUrl?: string): Promise<void>;
  getInstance(): Avoid;
}
