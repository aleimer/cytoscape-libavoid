// Stroke width of a material flow, shared by the demo's stylesheet and the
// routing models of the demo graphs, so routing spaces edges by the width
// that is drawn.

const MIN_WIDTH = 3;

/**
 * Width in px for a quantity: from MIN_WIDTH for nothing to `maxWidth` for the
 * largest flow of the graph, on a square-root scale, so 20 t next to 8000 t
 * still shows.
 */
export function flowWidth(quantity: number, maxQuantity: number, maxWidth: number): number {
  const share = maxQuantity > 0 ? Math.min(1, Math.max(0, quantity) / maxQuantity) : 0;
  return Math.round((MIN_WIDTH + (maxWidth - MIN_WIDTH) * Math.sqrt(share)) * 10) / 10;
}

/** A quantity as a label, e.g. `5.600 t`. */
export const flowLabel = (quantity: number): string => `${quantity.toLocaleString('de-DE')} t`;
