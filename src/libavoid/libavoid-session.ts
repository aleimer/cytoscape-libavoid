// A libavoid session: one routing run with the libavoid API used by
// EdgeRouter. It frees everything it allocates in WebAssembly memory.

import type { Point, Side } from '../shared/geometry';
import type { Avoid, ConnEnd, ConnRef, Deletable, Router, ShapeRef } from './api';
import { pluginError } from '../shared/errors';

// libavoid ConnDirFlags: the direction in which a connector may leave a pin
const DIRECTION_OF_SIDE: Record<Side, number> = { top: 1, bottom: 2, left: 4, right: 8 };

/**
 * One libavoid routing run. It owns everything it allocates in WebAssembly
 * memory, so always end it with dispose(), e.g. in a `finally` block.
 */
export class LibavoidSession {
  private readonly avoid: Avoid;
  private readonly router: Router;
  /** Helper objects to free in dispose(); shapes, pins and connectors are freed by the router itself. */
  private readonly allocations: Deletable[] = [];

  /** Routes orthogonally: horizontal and vertical segments only. */
  constructor(avoid: Avoid) {
    this.avoid = avoid;
    this.router = new avoid.Router(avoid.RouterFlag.OrthogonalRouting.value);
  }

  setParameter(name: string, value: number): void {
    const parameter = this.avoid.RoutingParameter[name];
    if (!parameter) throw pluginError(`unknown routing parameter "${name}"`);
    this.router.setRoutingParameter(parameter, value);
  }

  setOption(name: string, value: boolean): void {
    const option = this.avoid.RoutingOption[name];
    if (!option) throw pluginError(`unknown routing option "${name}"`);
    this.router.setRoutingOption(option, value);
  }

  /** Adds a rectangular obstacle around `centre`. */
  addShape(centre: Point, width: number, height: number): ShapeRef {
    const middle = this.track(new this.avoid.Point(centre.x, centre.y));
    const rectangle = this.track(new this.avoid.Rectangle(middle, width, height));
    return new this.avoid.ShapeRef(this.router, rectangle);
  }

  /**
   * Adds a pin in the middle of one side of a shape. Connectors attach to a pin class;
   * all pins of a shape with the same class are interchangeable, and any number of
   * connectors may share a pin.
   */
  addPin(shape: ShapeRef, classId: number, side: Side): void {
    // x / y as fractions of the shape size, (0, 0) = top left corner
    const x = side === 'left' ? 0 : side === 'right' ? 1 : 0.5;
    const y = side === 'top' ? 0 : side === 'bottom' ? 1 : 0.5;
    const proportional = true;
    const insideOffset = 0; // exactly on the border
    const pin = new this.avoid.ShapeConnectionPin(
      shape,
      classId,
      x,
      y,
      proportional,
      insideOffset,
      DIRECTION_OF_SIDE[side],
    );
    pin.setExclusive(false); // libavoid's default is one connector per pin
  }

  /** Adds a connector from a pin class of one shape to a pin class of another. */
  connect(source: ShapeRef, sourcePinClass: number, target: ShapeRef, targetPinClass: number): ConnRef {
    return this.connectEnds(this.shapeEnd(source, sourcePinClass), this.shapeEnd(target, targetPinClass));
  }

  /** A connector end at any pin of this class of a shape. */
  shapeEnd(shape: ShapeRef, pinClass: number): ConnEnd {
    return this.track(new this.avoid.ConnEnd(shape, pinClass));
  }

  /** A connector end at a free point, not attached to a shape; the connector may leave it in any direction. */
  pointEnd(point: Point): ConnEnd {
    return this.track(new this.avoid.ConnEnd(this.track(new this.avoid.Point(point.x, point.y))));
  }

  /** Adds a connector between two ends, see shapeEnd() and pointEnd(). */
  connectEnds(source: ConnEnd, target: ConnEnd): ConnRef {
    return new this.avoid.ConnRef(this.router, source, target);
  }

  /** Makes the connector pass through these points, in order. */
  setCheckpoints(connector: ConnRef, points: readonly Point[]): void {
    const checkpoints = this.track(new this.avoid.CheckpointVector());
    for (const { x, y } of points) {
      checkpoints.push_back(this.track(new this.avoid.Checkpoint(this.track(new this.avoid.Point(x, y)))));
    }
    connector.setRoutingCheckpoints(checkpoints);
  }

  /** Routes all connectors. */
  route(): void {
    this.router.processTransaction();
  }

  /** The routed points of a connector, from its source to its target. */
  pointsOf(connector: ConnRef): Point[] {
    const route = connector.displayRoute();
    try {
      const points: Point[] = [];
      for (let i = 0; i < route.size(); i++) {
        const point = route.at(i);
        points.push({ x: point.x, y: point.y });
        point.delete();
      }
      return points;
    } finally {
      route.delete();
    }
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
