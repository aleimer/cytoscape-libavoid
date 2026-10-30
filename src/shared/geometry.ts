/**
 * Plain geometry shared by all parts of the plugin: points, sides and axes of
 * axis-aligned rectangles. Knows nothing about graphs, Cytoscape or libavoid.
 */

/** A position in model coordinates, as Cytoscape's: y grows downwards. */
export interface Point
{
  x: number;
  y: number;
}

/** An axis-aligned rectangle around its centre, like a graph node. */
export interface Rect
{
  /** Centre x. */
  x: number;
  /** Centre y. */
  y: number;
  width: number;
  height: number;
}

/** A side of a rectangle; `top` is the one with the smaller y. */
export type Side = 'top' | 'right' | 'bottom' | 'left';

export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/** For values from outside, e.g. the `edgeSides` option. */
export const isSide = (value: unknown): value is Side => SIDES.includes(value as Side);

/**
 * A coordinate axis. Post-processing names a segment's axis by the coordinate it
 * can be moved along: x for a vertical segment, y for a horizontal one.
 */
export type Axis = 'x' | 'y';

/** y for x and x for y, e.g. the direction a run extends in from the axis it moves along. */
export const otherAxis = (axis: Axis): Axis => (axis === 'x' ? 'y' : 'x');

/** Half the size of a rectangle on an axis. */
export const halfSize = (rect: Rect, axis: Axis): number => (axis === 'x' ? rect.width : rect.height) / 2;

/** From where to where a rectangle reaches on an axis, grown by `margin` on both sides. */
export function extentOf(rect: Rect, axis: Axis, margin = 0): [low: number, high: number]
{
  const reach = halfSize(rect, axis) + margin;
  return [rect[axis] - reach, rect[axis] + reach];
}

/**
 * Of the `allowed` sides of `rect`, the one that faces `towards` most. Distances
 * count in half sizes, so a wide rectangle uses its top or bottom side unless the
 * point is clearly beside it. Ties go to the side listed first in `allowed`.
 */
export function sideFacing(rect: Rect, towards: Point, allowed: readonly Side[] = SIDES): Side
{
  const dx = (towards.x - rect.x) / (halfSize(rect, 'x') || 1);
  const dy = (towards.y - rect.y) / (halfSize(rect, 'y') || 1);
  const facing: Record<Side, number> = { top: -dy, right: dx, bottom: dy, left: -dx };
  return allowed.reduce((best, side) => (facing[side] > facing[best] ? side : best));
}

/** The middle of one side of `rect`. */
export function sideMiddle(rect: Rect, side: Side): Point
{
  const dx = side === 'left' ? -rect.width / 2 : side === 'right' ? rect.width / 2 : 0;
  const dy = side === 'top' ? -rect.height / 2 : side === 'bottom' ? rect.height / 2 : 0;
  return { x: rect.x + dx, y: rect.y + dy };
}
