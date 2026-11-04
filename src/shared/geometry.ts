/**
 * Plain geometry shared by all parts of the plugin: points, sides and axes of
 * axis-aligned rectangles. Knows nothing about graphs, Cytoscape or libavoid.
 */

/** A position in model coordinates, as Cytoscape's: y grows downwards. */
export interface Point
{
  /** Horizontal coordinate, growing to the right. */
  x: number;
  /** Vertical coordinate, growing downwards. */
  y: number;
}

/** An axis-aligned rectangle around its centre, like a graph node. */
export interface Rect
{
  /** Centre x. */
  x: number;
  /** Centre y. */
  y: number;
  /** Full width, from the left to the right side. */
  width: number;
  /** Full height, from the top to the bottom side. */
  height: number;
}

/** A side of a rectangle; `top` is the one with the smaller y. */
export type Side = 'top' | 'right' | 'bottom' | 'left';

/** All four sides, clockwise from the top. */
export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/**
 * Whether a value from outside, e.g. from the `edgeSides` option, is a {@link Side}.
 *
 * @param value any value
 * @returns true if it is one of {@link SIDES}
 */
export const isSide = (value: unknown): value is Side => SIDES.includes(value as Side);

/** A coordinate axis. */
export type Axis = 'x' | 'y';

/**
 * The perpendicular axis, e.g. the one a segment extends along when it moves along `axis`.
 *
 * @param axis x or y
 * @returns y for x and x for y
 */
export const otherAxis = (axis: Axis): Axis => (axis === 'x' ? 'y' : 'x');

/**
 * Half the size of a rectangle on an axis.
 *
 * @param rect the rectangle
 * @param axis x for half the width, y for half the height
 * @returns the distance from the centre to the sides on that axis
 */
export const halfSize = (rect: Rect, axis: Axis): number => (axis === 'x' ? rect.width : rect.height) / 2;

/**
 * From where to where a rectangle reaches on an axis.
 *
 * @param rect   the rectangle
 * @param axis   the axis to measure on
 * @param margin added on both sides; negative values shrink the extent
 * @returns the lowest and the highest coordinate on `axis`
 */
export function extentOf(rect: Rect, axis: Axis, margin = 0): [low: number, high: number]
{
  const reach = halfSize(rect, axis) + margin;
  return [rect[axis] - reach, rect[axis] + reach];
}

/**
 * The side of a rectangle that faces a point most. Distances count in half
 * sizes, so a wide rectangle uses its top or bottom side unless the point is
 * clearly beside it.
 *
 * @param rect    the rectangle
 * @param towards the point to face
 * @param allowed the sides to choose from; ties go to the one listed first
 * @returns one of `allowed`
 */
export function sideFacing(rect: Rect, towards: Point, allowed: readonly Side[] = SIDES): Side
{
  const dx = (towards.x - rect.x) / (halfSize(rect, 'x') || 1);
  const dy = (towards.y - rect.y) / (halfSize(rect, 'y') || 1);
  const facing: Record<Side, number> = { top: -dy, right: dx, bottom: dy, left: -dx };
  return allowed.reduce((best, side) => (facing[side] > facing[best] ? side : best));
}

/**
 * The centre of one side of a rectangle.
 *
 * @param rect the rectangle
 * @param side which side
 * @returns the point on the border, halfway along that side
 */
export function sideCentre(rect: Rect, side: Side): Point
{
  const dx = side === 'left' ? -rect.width / 2 : side === 'right' ? rect.width / 2 : 0;
  const dy = side === 'top' ? -rect.height / 2 : side === 'bottom' ? rect.height / 2 : 0;
  return { x: rect.x + dx, y: rect.y + dy };
}
