/// <reference path="./libavoid-js.d.ts" />
/*! cytoscape-libavoid uses libavoid-js (c) Vladyslav Hnatiuk and libavoid (c) Monash University,
 * both licensed under LGPL-2.1-or-later: https://github.com/Aksem/libavoid-js, https://github.com/mjwybrow/adaptagrams
 * See THIRD-PARTY-NOTICES.md and licenses/LGPL-2.1.txt of cytoscape-libavoid. */

// Connector to libavoid-js: loads the WebAssembly module and wraps the part of
// its API used by this package in LibavoidRouter. The typings shipped with
// libavoid-js are incomplete (no RouterFlag, no delete() on most classes) and
// fall back to `any`, so the namespace import is cast to the types below.

import * as libavoidJs from 'libavoid-js';

const { AvoidLib } = libavoidJs as unknown as { AvoidLib: AvoidLibLoader };

export interface Point {
  x: number;
  y: number;
}

export type Side = 'top' | 'right' | 'bottom' | 'left';

export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

export type RoutingType = 'orthogonal' | 'polyline';

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

// --- raw libavoid-js API -----------------------------------------------------

/** Any object in WebAssembly memory that must be freed explicitly. */
interface Deletable {
  delete(): void;
}

/** Value of a C++ enum exposed by libavoid-js. */
interface EnumValue {
  readonly value: number;
}

interface AvoidPoint extends Point, Deletable {}
interface Rectangle extends Deletable {}
interface ConnEnd extends Deletable {}

interface Router extends Deletable {
  processTransaction(): void;
  setRoutingParameter(parameter: EnumValue, value: number): void;
  setRoutingOption(option: EnumValue, value: boolean): void;
}

/** An obstacle; owned and freed by its router. */
export interface ShapeRef {
  id(): number;
}

/** Owned and freed by its shape. */
interface ShapeConnectionPin {
  setExclusive(exclusive: boolean): void;
}

interface PolyLine {
  size(): number;
  at(index: number): Point;
}

/** A routed connection between two shapes; owned and freed by its router. */
export interface ConnRef {
  displayRoute(): PolyLine;
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
  ConnEnd: new (shape: ShapeRef, pinClassId: number) => ConnEnd;
  ConnRef: new (router: Router, source: ConnEnd, target: ConnEnd) => ConnRef;
  RouterFlag: { readonly PolyLineRouting: EnumValue; readonly OrthogonalRouting: EnumValue };
  // Indexed by arbitrary strings because names come from user options at runtime.
  RoutingParameter: { readonly [name: string]: EnumValue | undefined };
  RoutingOption: { readonly [name: string]: EnumValue | undefined };
}

interface AvoidLibLoader {
  load(wasmUrl?: string): Promise<void>;
  getInstance(): Avoid;
}

// --- loading -----------------------------------------------------------------

let loading: Promise<Avoid> | null = null;

/** Loads the libavoid WebAssembly module once and caches the instance. */
export function loadLibavoid(wasmUrl?: string): Promise<Avoid> {
  if (!loading) {
    loading = AvoidLib.load(wasmUrl)
      .then(() => AvoidLib.getInstance())
      .catch((err: Error) => {
        loading = null; // allow a retry, e.g. with a corrected wasmUrl
        throw err;
      });
  }
  return loading;
}

// --- router ------------------------------------------------------------------

/** A connection point on one side of a shape. */
export interface PinSpec {
  /** Connectors attach to a pin class; all pins of a shape with the same class are interchangeable. */
  classId: number;
  side: Side;
  /** Position along the side: 0 = top / left end, 1 = bottom / right end. */
  offset: number;
  /** An exclusive pin is used by one connector only. */
  exclusive: boolean;
}

// libavoid ConnDirFlags: the direction in which a connector may leave a pin
const DIRECTION_OF_SIDE: Record<Side, number> = { top: 1, bottom: 2, left: 4, right: 8 };

/**
 * One libavoid routing run. It owns everything it allocates in WebAssembly
 * memory, so always end it with dispose(), e.g. in a `finally` block.
 */
export class LibavoidRouter {
  private readonly avoid: Avoid;
  private readonly router: Router;
  /** Helper objects to free in dispose(); shapes, pins and connectors are freed by the router itself. */
  private readonly allocations: Deletable[] = [];

  constructor(avoid: Avoid, routingType: RoutingType) {
    this.avoid = avoid;
    const flag = routingType === 'polyline' ? avoid.RouterFlag.PolyLineRouting : avoid.RouterFlag.OrthogonalRouting;
    this.router = new avoid.Router(flag.value);
  }

  setParameter(name: string, value: number): void {
    const parameter = this.avoid.RoutingParameter[name];
    if (!parameter) throw new Error(`cytoscape-libavoid: unknown routing parameter "${name}"`);
    this.router.setRoutingParameter(parameter, value);
  }

  setOption(name: string, value: boolean): void {
    const option = this.avoid.RoutingOption[name];
    if (!option) throw new Error(`cytoscape-libavoid: unknown routing option "${name}"`);
    this.router.setRoutingOption(option, value);
  }

  /** Adds a rectangular obstacle around `centre`. */
  addShape(centre: Point, width: number, height: number): ShapeRef {
    const middle = this.track(new this.avoid.Point(centre.x, centre.y));
    const rectangle = this.track(new this.avoid.Rectangle(middle, width, height));
    return new this.avoid.ShapeRef(this.router, rectangle);
  }

  addPin(shape: ShapeRef, pin: PinSpec): void {
    // x / y as fractions of the shape size, (0, 0) = top left corner
    const x = pin.side === 'left' ? 0 : pin.side === 'right' ? 1 : pin.offset;
    const y = pin.side === 'top' ? 0 : pin.side === 'bottom' ? 1 : pin.offset;
    const proportional = true;
    const insideOffset = 0; // exactly on the border
    const created = new this.avoid.ShapeConnectionPin(
      shape,
      pin.classId,
      x,
      y,
      proportional,
      insideOffset,
      DIRECTION_OF_SIDE[pin.side],
    );
    created.setExclusive(pin.exclusive);
  }

  /** Adds a connector from a pin class of one shape to a pin class of another. */
  connect(source: ShapeRef, sourcePinClass: number, target: ShapeRef, targetPinClass: number): ConnRef {
    const sourceEnd = this.track(new this.avoid.ConnEnd(source, sourcePinClass));
    const targetEnd = this.track(new this.avoid.ConnEnd(target, targetPinClass));
    return new this.avoid.ConnRef(this.router, sourceEnd, targetEnd);
  }

  /** Routes all connectors. */
  route(): void {
    this.router.processTransaction();
  }

  /** The routed polyline of a connector, from its source to its target. */
  pointsOf(connector: ConnRef): Point[] {
    const route = connector.displayRoute();
    const points: Point[] = [];
    for (let i = 0; i < route.size(); i++) {
      const { x, y } = route.at(i);
      points.push({ x, y });
    }
    return points;
  }

  dispose(): void {
    for (const allocation of this.allocations) allocation.delete();
    this.allocations.length = 0;
    this.router.delete(); // also frees shapes, pins and connectors
  }

  private track<T extends Deletable>(allocation: T): T {
    this.allocations.push(allocation);
    return allocation;
  }
}
