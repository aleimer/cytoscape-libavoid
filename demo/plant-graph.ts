// Steel plant material flow on the node positions of the production app
// (BASE_POSITIONS, grid units, y grows downwards). The flows are made up: a
// plausible route from raw material to the customer, plus edges that are
// there to provoke overlaps. Each group names the problem it simulates.
// Quantities are t/day, roughly balanced per station; the largest is the hot
// strip mill WBB with 8000 t/day. Iron ore pellets are not part of the graph,
// so the blast furnaces put out more than they get.
// PLANT_GROUPS adds the app's compound nodes; plantView() collapses them.
// Used by the demo (?graph=plant), `npm run quality` and test/separation.test.ts.

import type { GraphModel } from '../src';
import { flowWidth } from './flow-width';

export const PLANT_POSITIONS: Readonly<Record<string, { x: number; y: number }>> = {
  'KW-F': { x: 7.0, y: 5.0 },
  'KW-H': { x: 12.0, y: 3.0 },
  'KW-K': { x: 14.0, y: 3.0 },
  'KW-L1': { x: 14.0, y: 5.0 },
  'KW-L2': { x: 14.5, y: 4.0 },
  'KW-P': { x: 16.0, y: 3.0 },
  'KW-S': { x: 18.5, y: 4.0 },
  'KW-T': { x: 18.0, y: 3.0 },
  'KW-U': { x: 18.5, y: 2.0 },
  'KW-X': { x: 8.5, y: 3.0 },
  'KW-Z': { x: 11.0, y: 3.0 },

  SGA4: { x: -5.5, y: 2.0 },
  SGA1: { x: -5.5, y: 3.0 },
  SGA2: { x: -5.5, y: 4.0 },
  SGA3: { x: -5.5, y: 5.0 },

  VPL1: { x: -7.0, y: 1.0 },
  VPL2: { x: -7.0, y: 2.0 },
  VPL3: { x: -7.0, y: 3.0 },
  VPL4: { x: -7.0, y: 4.0 },
  VPL5: { x: -7.0, y: 5.0 },

  RH6: { x: -7.0, y: 6.5 },
  RH7: { x: -7.0, y: 7.5 },

  'KON-A': { x: -8.5, y: 1.5 },
  'KON-C': { x: -8.5, y: 2.5 },
  'KON-B': { x: -8.5, y: 3.5 },

  RE1: { x: -9.5, y: 1.5 },
  RE2: { x: -9.5, y: 2.5 },
  RE3: { x: -9.5, y: 3.5 },

  HoA: { x: -11.0, y: 1.5 },
  HoB: { x: -11.0, y: 2.5 },
  HoC: { x: -11.0, y: 3.5 },

  SIN: { x: -15.0, y: 1.0 },
  KOK: { x: -15.0, y: 6.0 },

  DRP1: { x: -11.0, y: 5.5 },
  EAF1: { x: -8.5, y: 5.5 },

  CUST: { x: -9.5, y: 10.5 },
  SCRAP: { x: -11.5, y: 10.5 },
  RAW: { x: -12.5, y: 10.5 },

  'OV-B': { x: 20.0, y: 7.0 },
  'OV-H': { x: 20.0, y: 6.0 },
  'OV-J': { x: 22.5, y: 7.0 },
  'OV-K': { x: 22.0, y: 6.0 },
  'OV-L': { x: 22.0, y: 4.0 },
  'OV-M': { x: 20.0, y: 5.0 },
  'OV-N': { x: 20.0, y: 4.0 },
  'OV-P': { x: 20.0, y: 3.0 },
  'OV-T': { x: 23.5, y: 7.0 },
  'OV-X': { x: 22.5, y: 5.0 },
  'OV-Y': { x: 24.0, y: 6.0 },
  'OV-Z': { x: 23.5, y: 5.0 },

  'TW-D': { x: 3.0, y: 5.0 },
  'TW-DS': { x: 3.0, y: 2.0 },
  'TW-E': { x: 5.0, y: 4.5 },
  'TW-FL': { x: 3.0, y: 3.0 },
  'TW-R': { x: 4.0, y: 2.0 },

  'WBT-A': { x: 7.0, y: 1.0 },
  'WBT-B': { x: 6.0, y: 1.0 },
  'WBT-BC': { x: 6.0, y: 2.0 },

  BB2: { x: 21.0, y: 4.0 },
  CBL2: { x: 4.0, y: 4.0 },
  CL4: { x: 18.5, y: 1.0 },
  CL5: { x: 23.5, y: 4.0 },
  DR3: { x: 17.0, y: 3.0 },
  EVZ: { x: 21.0, y: 3.0 },
  FV1: { x: 21.0, y: 5.0 },
  FV2: { x: 21.0, y: 6.0 },
  FV3: { x: 21.0, y: 7.0 },
  GLU: { x: 14.0, y: 2.0 },
  KB2: { x: 10.0, y: 3.0 },
  SBE: { x: 5.0, y: 6.0 },
  TAN: { x: 13.0, y: 3.0 },
  WBB: { x: 2.0, y: 3.0 },
  WS2: { x: 5.0, y: 2.0 },
  WBT: { x: 7.0, y: 2.0 },

  'VSH-V4': { x: 14.0, y: 8.0 },
  'VSH-U1': { x: 20.0, y: 8.0 },
};

type Flow = [source: string, target: string, quantity: number];

/** The daily production of the hot strip mill WBB, the largest flow, for the stroke widths. */
export const PLANT_MAX_QUANTITY = 8000;
/**
 * The stroke width of the largest flow (px). Nodes one grid step apart leave
 * 30 px gaps: with 12 px all flows still fit beside each other, from 14 px on
 * they overlap in the narrowest gaps (`npm run quality`).
 */
export const PLANT_MAX_WIDTH = 12;

export const PLANT_FLOWS: ReadonlyArray<{ challenge: string; flows: readonly Flow[] }> = [
  {
    challenge: 'fan-out and fan-in that cross each other: sinter and coke into three blast furnaces',
    flows: [
      ['RAW', 'SIN', 7900],
      ['RAW', 'KOK', 6300],
      ['SIN', 'HoA', 2700],
      ['SIN', 'HoB', 2800],
      ['SIN', 'HoC', 2150],
      ['KOK', 'HoA', 1730],
      ['KOK', 'HoB', 1790],
      ['KOK', 'HoC', 1350],
    ],
  },
  {
    challenge: 'dense columns half a grid step apart (HoX / REX / KON-X / VPLX), crossing in the narrow gaps',
    flows: [
      ['HoA', 'RE1', 4950],
      ['HoB', 'RE2', 5100],
      ['HoC', 'RE3', 3850],
      ['RE1', 'KON-A', 4900],
      ['RE2', 'KON-C', 3900],
      ['RE2', 'KON-B', 1200],
      ['RE3', 'KON-B', 3800],
      ['KON-A', 'VPL1', 2200],
      ['KON-A', 'VPL2', 3000],
      ['KON-C', 'VPL2', 2400],
      ['KON-C', 'VPL3', 1800],
      ['KON-B', 'VPL3', 2000],
      ['KON-B', 'VPL4', 3150],
      ['VPL1', 'SGA4', 1800],
      ['VPL2', 'SGA1', 4600],
      ['VPL3', 'SGA2', 2900],
      ['VPL4', 'SGA3', 500],
      ['VPL5', 'SGA3', 1100],
      ['VPL2', 'SGA4', 800],
      ['VPL4', 'SGA1', 3550],
    ],
  },
  {
    challenge: 'scrap fanning up through the furnace columns; electric route on the side',
    flows: [
      ['SCRAP', 'KON-A', 800],
      ['SCRAP', 'KON-B', 650],
      ['SCRAP', 'KON-C', 700],
      ['SCRAP', 'EAF1', 1000],
      ['RAW', 'DRP1', 2800],
      ['DRP1', 'EAF1', 1900],
      ['EAF1', 'VPL5', 1700],
      ['EAF1', 'VPL4', 900],
    ],
  },
  {
    challenge: 'within one column: edges between nodes that have other nodes of the column in between',
    flows: [
      ['VPL3', 'RH6', 900],
      ['RH6', 'SGA3', 900],
      ['VPL5', 'RH7', 600],
      ['RH7', 'SGA3', 980],
      ['VPL1', 'RH7', 400],
    ],
  },
  {
    challenge: 'casters to the rolling mills: long parallel bundle through the empty middle of the plant',
    flows: [
      ['SGA4', 'WBT-B', 1900],
      ['SGA1', 'WBB', 5600],
      ['SGA1', 'WBB', 2400], // a second edge between the same nodes
      ['SGA2', 'TW-FL', 1200],
      ['SGA3', 'TW-D', 2300],
      ['SGA1', 'KW-X', 150], // along row y = 3, through WBB and TW-FL
      ['SGA2', 'CBL2', 1700],
      ['SGA3', 'SBE', 1150],
      ['SGA4', 'WS2', 600],
    ],
  },
  {
    challenge: 'small clusters (TW, WBT) with flows in all directions',
    flows: [
      ['WBB', 'TW-FL', 3800],
      ['TW-FL', 'TW-DS', 4900],
      ['TW-DS', 'TW-R', 4800],
      ['TW-R', 'WS2', 4500],
      ['TW-D', 'TW-E', 2250],
      ['TW-E', 'CBL2', 2200],
      ['CBL2', 'KW-F', 3800],
      ['SBE', 'KW-F', 900],
      ['WBT-B', 'WBT-BC', 1300],
      ['WBT-BC', 'WBT', 6200],
      ['WBT-A', 'WBT', 450],
      ['WBT-B', 'WBT-A', 580],
      ['WS2', 'WBT-BC', 5000],
      ['WBT', 'KW-X', 4400],
    ],
  },
  {
    challenge: 'main line on row y = 3 with one node per grid step, and edges skipping nodes of the row',
    flows: [
      ['KW-X', 'KB2', 4100],
      ['KB2', 'KW-Z', 3700],
      ['KW-Z', 'KW-H', 3300],
      ['KW-H', 'TAN', 2400],
      ['TAN', 'KW-K', 2380],
      ['KW-K', 'KW-L1', 1200],
      ['KW-K', 'KW-L2', 1350],
      ['KW-L1', 'KW-P', 900],
      ['KW-L2', 'KW-S', 600],
      ['KW-P', 'DR3', 3000],
      ['DR3', 'KW-T', 3400],
      ['KW-T', 'KW-S', 1500],
      ['KW-T', 'KW-U', 1200],
      ['KW-H', 'KW-P', 880], // skips TAN and KW-K
      ['KW-X', 'KW-T', 400], // skips eight nodes
      ['KB2', 'DR3', 380],
      ['KW-Z', 'KW-K', 380],
      ['WBT', 'GLU', 2200], // long run along row y = 2
      ['GLU', 'KW-P', 2150],
      ['KW-F', 'KW-L1', 2600], // long run along row y = 5
    ],
  },
  {
    challenge: 'flows in both directions between the same nodes',
    flows: [
      ['KW-T', 'DR3', 70],
      ['EVZ', 'OV-P', 30],
      ['TW-E', 'TW-D', 40],
      ['KON-C', 'RE2', 60],
    ],
  },
  {
    challenge: 'finishing lines (OV, FV): a dense 4 x 5 block with lines snaking through it',
    flows: [
      ['KW-S', 'OV-N', 700],
      ['KW-S', 'BB2', 600],
      ['KW-T', 'OV-P', 1000],
      ['KW-U', 'CL4', 800],
      ['CL4', 'OV-P', 650],
      ['OV-P', 'EVZ', 1100],
      ['EVZ', 'OV-L', 1000],
      ['OV-N', 'BB2', 1100],
      ['BB2', 'OV-L', 1650],
      ['OV-L', 'CL5', 1900],
      ['OV-M', 'FV1', 1450],
      ['FV1', 'OV-X', 1400],
      ['OV-X', 'OV-Z', 1050],
      ['OV-H', 'FV2', 700],
      ['FV2', 'OV-K', 720],
      ['OV-K', 'OV-Y', 1300],
      ['OV-B', 'FV3', 1100],
      ['FV3', 'OV-J', 1050],
      ['OV-J', 'OV-T', 700],
      ['KW-L1', 'OV-M', 1500],
      ['KW-L2', 'OV-H', 450],
      ['KW-F', 'OV-B', 900],
      ['KW-P', 'OV-N', 900],
    ],
  },
  {
    challenge: 'chaos in the OV block: jumps over nodes, rework loops, fan-in and fan-out, edges right across it',
    flows: [
      // along the OV column x = 20, skipping the nodes in between, both ways
      ['OV-P', 'OV-B', 350],
      ['OV-B', 'OV-P', 25],
      ['OV-N', 'OV-H', 200],
      // diagonally across the block
      ['OV-P', 'OV-T', 280],
      ['OV-T', 'OV-P', 40],
      ['OV-B', 'OV-L', 90],
      ['OV-Y', 'OV-N', 40],
      ['OV-Z', 'OV-M', 40],
      ['CL5', 'OV-H', 150],
      // fan-in: seven edges into OV-K from all sides
      ['OV-M', 'OV-K', 70],
      ['OV-N', 'OV-K', 300],
      ['OV-B', 'OV-K', 50],
      ['EVZ', 'OV-K', 60],
      ['OV-T', 'OV-K', 40],
      ['CL4', 'OV-K', 140],
      // fan-out from OV-X in all directions
      ['OV-X', 'OV-B', 60],
      ['OV-X', 'OV-P', 30],
      ['OV-X', 'OV-Y', 90],
      ['OV-X', 'OV-J', 80],
      ['OV-X', 'CL5', 60],
      // rework: back from the furnaces into the line they came from
      ['FV1', 'OV-M', 30],
      ['FV2', 'OV-H', 35],
      ['FV3', 'OV-B', 25],
      // parallel edges between the same nodes
      ['OV-L', 'CL5', 400],
      ['OV-L', 'CL5', 380],
      ['OV-H', 'FV2', 90],
      // from the rolling mills right through the block, and back
      ['KW-S', 'OV-T', 750],
      ['KW-U', 'OV-Y', 250],
      ['OV-Y', 'KW-P', 50],
      ['OV-T', 'KW-L1', 60],
      // more long runs out of the block
      ['OV-J', 'SCRAP', 40],
      ['OV-K', 'CUST', 60],
    ],
  },
  {
    challenge: 'fan-in to shipping, then two long runs back to the customer at the far left',
    flows: [
      ['OV-T', 'VSH-U1', 1500],
      ['OV-Y', 'VSH-U1', 1250],
      ['OV-Z', 'VSH-U1', 900],
      ['CL5', 'VSH-U1', 2300],
      ['OV-J', 'VSH-U1', 380],
      ['KW-L1', 'VSH-V4', 1400],
      ['KW-L2', 'VSH-V4', 280],
      ['KW-F', 'VSH-V4', 1100],
      ['SBE', 'VSH-V4', 230],
      ['WBB', 'VSH-V4', 4100], // hot-rolled coil shipped directly, right across the plant
      ['VSH-V4', 'CUST', 7100],
      ['VSH-U1', 'CUST', 6300],
      ['OV-Y', 'CUST', 200],
    ],
  },
  {
    challenge: 'scrap returns from all over the plant: long edges against the flow into one node',
    flows: [
      ['KW-U', 'SCRAP', 120],
      ['OV-Z', 'SCRAP', 90],
      ['CL5', 'SCRAP', 180],
      ['TW-R', 'SCRAP', 300],
      ['WBT-A', 'SCRAP', 120],
      ['KW-K', 'SCRAP', 150],
      ['SGA4', 'SCRAP', 100],
      ['RH7', 'SCRAP', 20],
    ],
  },
];

export interface PlantScale {
  /** Pixels per grid unit. @default 100 */
  grid: number;
  nodeWidth: number;
  nodeHeight: number;
}

/**
 * With the defaults, nodes one grid step apart leave a 30 px gap: less than
 * twice the default shapeBufferDistance, so libavoid cannot route through it.
 */
export const DEFAULT_PLANT_SCALE: Readonly<PlantScale> = Object.freeze({ grid: 100, nodeWidth: 70, nodeHeight: 40 });

/** One entry per flow; a repeated source / target pair gets a numbered id. */
export function plantFlows(): Array<{ id: string; source: string; target: string; quantity: number }> {
  const seen = new Map<string, number>();
  return PLANT_FLOWS.flatMap((group) => group.flows).map(([source, target, quantity]) => {
    const key = `${source}->${target}`;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    return { id: count === 1 ? key : `${key}#${count}`, source, target, quantity };
  });
}

/** Node centres in px. */
export function plantPositions(grid = DEFAULT_PLANT_SCALE.grid): Array<{ id: string; x: number; y: number }> {
  return Object.entries(PLANT_POSITIONS).map(([id, p]) => ({ id, x: p.x * grid, y: p.y * grid }));
}

// --- groups ----------------------------------------------------------------------

/**
 * Compound nodes of the production app. Without a parent a group only frames
 * its members visually; with a parent it can be collapsed into a single node
 * that takes over its members' edges. The groups are from the app, the members
 * are guessed from the names.
 */
export const PLANT_GROUPS: ReadonlyArray<{ id: string; parent?: string; members: readonly string[] }> = [
  { id: 'TW', members: ['TW-DS', 'TW-FL', 'TW-R'] },
  { id: 'TK', members: [] },
  { id: 'TH', members: [] },
  { id: 'TS', members: [] },
  { id: 'TW-DEF', parent: 'TW', members: ['TW-D', 'TW-E'] },
  { id: 'KW-STU', parent: 'TK', members: ['KW-S', 'KW-T', 'KW-U'] },
  { id: 'OV-MN', parent: 'TK', members: ['OV-M', 'OV-N'] },
  { id: 'OV-JKLX', parent: 'TK', members: ['OV-J', 'OV-K', 'OV-L', 'OV-X'] },
  { id: 'Ho-ABC', parent: 'TH', members: ['HoA', 'HoB', 'HoC'] },
  { id: 'RE-123', parent: 'TS', members: ['RE1', 'RE2', 'RE3'] },
  { id: 'KON-ABC', parent: 'TS', members: ['KON-A', 'KON-B', 'KON-C'] },
  { id: 'VPL-12345', parent: 'TS', members: ['VPL1', 'VPL2', 'VPL3', 'VPL4', 'VPL5'] },
  { id: 'RH-67', parent: 'TS', members: ['RH6', 'RH7'] },
  { id: 'SGA-1234', parent: 'TS', members: ['SGA1', 'SGA2', 'SGA3', 'SGA4'] },
];

const PARENT_OF: ReadonlyMap<string, string> = new Map(
  PLANT_GROUPS.flatMap((group) => [
    ...group.members.map((member): [string, string] => [member, group.id]),
    ...(group.parent ? [[group.id, group.parent] as [string, string]] : []),
  ]),
);

/** Every group that can be collapsed: the ones with a parent. */
export const COLLAPSIBLE_GROUPS: readonly string[] = PLANT_GROUPS.filter((group) => group.parent).map(
  (group) => group.id,
);

export const isCollapsible = (groupId: string): boolean => COLLAPSIBLE_GROUPS.includes(groupId);

/** Enclosing groups, innermost first. */
function ancestorsOf(id: string): string[] {
  const result: string[] = [];
  for (let parent = PARENT_OF.get(id); parent; parent = PARENT_OF.get(parent)) result.push(parent);
  return result;
}

export interface PlantView {
  /** Plant nodes and collapsed groups: the nodes edges attach to. */
  nodes: Array<{ id: string; x: number; y: number; parent?: string | undefined; collapsed: boolean }>;
  /** Expanded groups: compound nodes, neither obstacles nor edge ends. */
  groups: Array<{ id: string; parent?: string | undefined; collapsible: boolean }>;
  /** Edges between visible nodes; an edge into a collapsed group gets its own id. */
  edges: Array<{ id: string; source: string; target: string; quantity: number }>;
}

/**
 * The plant with the given groups collapsed, the way a collapse plugin shows
 * it: the members of a collapsed group are gone, the group is a node in their
 * middle, edges to members end at the group and edges inside it are dropped.
 *
 * @param positions node centres in px (default: PLANT_POSITIONS on the default grid)
 */
export function plantView(
  collapsed: ReadonlySet<string> = new Set(),
  positions: ReadonlyMap<string, { x: number; y: number }> = new Map(
    plantPositions().map(({ id, x, y }) => [id, { x, y }]),
  ),
): PlantView {
  // the outermost collapsed group stands in for everything inside it
  const representative = (id: string): string => {
    let result = id;
    for (const group of ancestorsOf(id)) if (collapsed.has(group) && isCollapsible(group)) result = group;
    return result;
  };
  const view: PlantView = { nodes: [], groups: [], edges: [] };
  const leaves = Object.keys(PLANT_POSITIONS);

  for (const id of leaves) {
    if (representative(id) !== id) continue;
    const { x, y } = positions.get(id) ?? { x: 0, y: 0 };
    view.nodes.push({ id, x, y, parent: PARENT_OF.get(id), collapsed: false });
  }
  for (const group of PLANT_GROUPS) {
    if (representative(group.id) !== group.id) continue;
    if (!collapsed.has(group.id) || !group.parent) {
      view.groups.push({ id: group.id, parent: group.parent, collapsible: group.parent !== undefined });
      continue;
    }
    // collapsed: in the middle of its members
    const members = leaves.filter((id) => ancestorsOf(id).includes(group.id)).map((id) => positions.get(id)!);
    const xs = members.map((p) => p.x);
    const ys = members.map((p) => p.y);
    const x = (Math.min(...xs) + Math.max(...xs)) / 2;
    const y = (Math.min(...ys) + Math.max(...ys)) / 2;
    view.nodes.push({ id: group.id, x, y, parent: group.parent, collapsed: true });
  }
  for (const flow of plantFlows()) {
    const source = representative(flow.source);
    const target = representative(flow.target);
    if (source === target) continue; // inside a collapsed group
    const redirected = source !== flow.source || target !== flow.target;
    view.edges.push({ ...flow, id: redirected ? `${flow.id}|${source}->${target}` : flow.id, source, target });
  }
  return view;
}

/** The plant as a routing model, optionally with collapsed groups; edge widths as drawn in the demo. */
export function plantModel(scale: Partial<PlantScale> = {}, collapsed: ReadonlySet<string> = new Set()): GraphModel {
  const { grid, nodeWidth, nodeHeight } = { ...DEFAULT_PLANT_SCALE, ...scale };
  const positions = new Map(plantPositions(grid).map(({ id, x, y }) => [id, { x, y }]));
  const view = plantView(collapsed, positions);
  return {
    nodes: view.nodes.map(({ id, x, y }) => ({ id, x, y, width: nodeWidth, height: nodeHeight })),
    edges: view.edges.map(({ id, source, target, quantity }) => ({
      id,
      source,
      target,
      width: flowWidth(quantity, PLANT_MAX_QUANTITY, PLANT_MAX_WIDTH),
    })),
  };
}
