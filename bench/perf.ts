// Routing core only (no Cytoscape): node --import ./scripts/ts-resolve.ts bench/perf.ts '[{"ports":"auto"},{"ports":"docking"}]'
import { loadLibavoid } from '../src/libavoid';
import { EdgeRouter } from '../src/routing';
import type { GraphEdge, GraphNode, RoutingOptions } from '../src/routing';
const Avoid = await loadLibavoid();
const nodes: GraphNode[] = [],
  edges: GraphEdge[] = [];
for (let col = 0; col < 8; col++)
  for (let row = 0; row < 8; row++)
    nodes.push({ id: `n${col}_${row}`, x: col * 220, y: row * 120, width: 60, height: 50 });
let k = 0;
for (let col = 0; col < 7; col++)
  for (let row = 0; row < 8; row++) {
    edges.push({
      id: `e${k++}`,
      source: `n${col}_${row}`,
      target: `n${col + 1}_${(row * 3 + 1) % 8}`,
      width: 2 + (k % 10),
    });
    edges.push({
      id: `e${k++}`,
      source: `n${col}_${row}`,
      target: `n${Math.min(7, col + 2)}_${(row + 5) % 8}`,
      width: 2 + (k % 7),
    });
  }
const variants: Partial<RoutingOptions>[] = JSON.parse(process.argv[2] || '[{}]');
for (const v of variants) {
  const t = performance.now();
  new EdgeRouter(Avoid, v).route({ nodes, edges });
  console.log(JSON.stringify(v), (performance.now() - t).toFixed(0), 'ms');
}
