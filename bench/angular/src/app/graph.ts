import type { ElementDefinition } from 'cytoscape';

// Material-flow style test graph: stages laid out left to right, each stage has
// groups (compound nodes, for expand-collapse) holding process nodes that show
// live data as an SVG mini chart (node-html-label).

export interface GraphSize {
  stages: number;
  groupsPerStage: number;
  nodesPerGroup: number;
}

export const SIZES: Record<string, GraphSize> = {
  S: { stages: 5, groupsPerStage: 3, nodesPerGroup: 3 }, // 45 nodes, ~80 edges
  M: { stages: 8, groupsPerStage: 4, nodesPerGroup: 4 }, // 128 nodes, ~230 edges
  L: { stages: 12, groupsPerStage: 5, nodesPerGroup: 5 }, // 300 nodes, ~550 edges
};

export const NODE_W = 120;
export const NODE_H = 64;
const GAP_X = 120;
const GAP_Y = 40;
const GROUP_GAP = 80;
export const SERIES_LEN = 8;

/** Deterministic PRNG so every run gets the same graph. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function series(rand: () => number): number[] {
  return Array.from({ length: SERIES_LEN }, () => Math.round(rand() * 100));
}

export function buildGraph(size: GraphSize, seed = 1): ElementDefinition[] {
  const rand = rng(seed);
  const els: ElementDefinition[] = [];
  const stages: string[][] = [];
  const cols = Math.ceil(Math.sqrt(size.nodesPerGroup));
  const rows = Math.ceil(size.nodesPerGroup / cols);
  const groupW = cols * NODE_W + (cols - 1) * GAP_Y;
  const groupH = rows * NODE_H + (rows - 1) * GAP_Y;

  for (let s = 0; s < size.stages; s++) {
    const stageNodes: string[] = [];
    for (let g = 0; g < size.groupsPerStage; g++) {
      const gid = `g${s}_${g}`;
      els.push({ group: 'nodes', data: { id: gid, label: `Area ${s + 1}.${g + 1}` }, classes: 'group' });
      const x0 = s * (groupW + GAP_X * 2);
      const y0 = g * (groupH + GROUP_GAP);
      for (let i = 0; i < size.nodesPerGroup; i++) {
        const id = `n${s}_${g}_${i}`;
        const x = x0 + (i % cols) * (NODE_W + GAP_Y) + NODE_W / 2;
        const y = y0 + Math.floor(i / cols) * (NODE_H + GAP_Y) + NODE_H / 2;
        els.push({
          group: 'nodes',
          data: { id, parent: gid, name: `P-${s}${g}${i}`, value: Math.round(rand() * 1000), series: series(rand) },
          position: { x, y },
          classes: 'process',
        });
        stageNodes.push(id);
      }
    }
    stages.push(stageNodes);
  }

  // every node feeds 1-2 nodes of the next stage and sometimes one two stages ahead
  let k = 0;
  for (let s = 0; s < stages.length - 1; s++) {
    for (const src of stages[s]) {
      const next = stages[s + 1];
      const targets = new Set([next[Math.floor(rand() * next.length)]]);
      if (rand() < 0.5) targets.add(next[Math.floor(rand() * next.length)]);
      if (s + 2 < stages.length && rand() < 0.2) targets.add(stages[s + 2][Math.floor(rand() * stages[s + 2].length)]);
      for (const tgt of targets) els.push({ group: 'edges', data: { id: `e${k++}`, source: src, target: tgt, flow: 2 + Math.round(rand() * 8) } });
    }
  }
  return els;
}
