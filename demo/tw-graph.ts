// The cold rolling section of the steel plant as the production app shows it,
// in t/day: WBB feeds both TW stores, which pass coils between each other on
// thin edges and on to KW-X. The thick WBB edges arrive at the sides the thin
// edges leave from and turn towards WBB; they attach at the centre of those
// sides with the thin edges next to them. Used by demo/main.ts (?graph=tw) and
// test/separation.test.ts.

import type { GraphModel } from '../src';
import { flowWidth } from './flow-width';

export const TW_NODES: ReadonlyArray<[id: string, x: number, y: number]> = [
  ['WBB', 0, 400],
  ['TW-FL', 600, 0],
  ['TW-D', 600, 800],
  ['KW-X', 1200, 400],
  ['KB2', 1600, 400],
];

export const TW_FLOWS: ReadonlyArray<[source: string, target: string, quantity: number]> = [
  ['WBB', 'TW-FL', 1233],
  ['WBB', 'TW-D', 2047],
  ['TW-FL', 'TW-D', 40],
  ['TW-D', 'TW-FL', 90],
  ['TW-FL', 'KW-X', 1615],
  ['TW-D', 'KW-X', 793],
  ['KW-X', 'KB2', 2283],
];

/** The largest flow and the stroke width it gets (px). */
export const TW_MAX_QUANTITY = Math.max(...TW_FLOWS.map(([, , quantity]) => quantity));
export const TW_MAX_WIDTH = 50;

/** Node size, also used by the demo's stylesheet. */
export const TW_NODE_SIZE = Object.freeze({ width: 200, height: 200 });

/** The section as a routing model. */
export function twModel(): GraphModel
{
  return {
    nodes: TW_NODES.map(([id, x, y]) => ({ id, x, y, ...TW_NODE_SIZE })),
    edges: TW_FLOWS.map(([source, target, quantity]) => ({
      id: `${source}->${target}`,
      source,
      target,
      width: flowWidth(quantity, TW_MAX_QUANTITY, TW_MAX_WIDTH),
    })),
  };
}
