// The small material flow of the demo: stores -> processes -> sinks, in t/day;
// every station passes on what it receives. QS is an obstacle only. Used by
// demo/main.ts and `npm run quality`.

import type { GraphModel } from '../src';
import { flowWidth } from './flow-width';

export const SMALL_NODES: ReadonlyArray<[id: string, label: string, x: number, y: number]> = [
  ['lager', 'Rohlager', 0, 150],
  ['zukauf', 'Zukauf', 0, 400],
  ['saege', 'Säge', 260, 80],
  ['fraese', 'Fräse', 260, 260],
  ['drehen', 'Drehen', 260, 440],
  ['montage', 'Montage', 540, 200],
  ['lack', 'Lackierung', 540, 420],
  ['versand', 'Versand', 820, 220],
  ['schrott', 'Schrott', 820, 460],
  ['qs', 'QS', 400, 330],
];

export const SMALL_FLOWS: ReadonlyArray<[source: string, target: string, quantity: number]> = [
  ['lager', 'saege', 180],
  ['lager', 'fraese', 100],
  ['zukauf', 'drehen', 120],
  ['zukauf', 'montage', 45],
  ['saege', 'montage', 160],
  ['saege', 'schrott', 20],
  ['fraese', 'montage', 85],
  ['fraese', 'lack', 15],
  ['drehen', 'lack', 110],
  ['drehen', 'schrott', 10],
  ['montage', 'versand', 250],
  ['lack', 'versand', 165],
  ['montage', 'lack', 40],
];

/** The largest flow and the stroke width it gets (px); the gaps between the nodes are wide. */
export const SMALL_MAX_QUANTITY = Math.max(...SMALL_FLOWS.map(([, , quantity]) => quantity));
export const SMALL_MAX_WIDTH = 18;

/** Node size, also used by the demo's stylesheet. */
export const SMALL_NODE_SIZE = Object.freeze({ width: 90, height: 70 });

/** The small flow as a routing model. */
export function smallModel(): GraphModel
{
  return {
    nodes: SMALL_NODES.map(([id, , x, y]) => ({ id, x, y, ...SMALL_NODE_SIZE })),
    edges: SMALL_FLOWS.map(([source, target, quantity]) => ({
      id: `${source}-${target}`,
      source,
      target,
      width: flowWidth(quantity, SMALL_MAX_QUANTITY, SMALL_MAX_WIDTH),
    })),
  };
}
