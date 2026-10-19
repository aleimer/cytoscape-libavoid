import { AvoidLib } from 'libavoid-js';
await AvoidLib.load(); const Avoid = AvoidLib.getInstance();
import { routeGraph } from '../src/routing.js';
const nodes = [], edges = [];
for (let col = 0; col < 8; col++) for (let row = 0; row < 8; row++) nodes.push({ id: `n${col}_${row}`, x: col * 220, y: row * 120, w: 60, h: 50 });
let k = 0;
for (let col = 0; col < 7; col++) for (let row = 0; row < 8; row++) {
  edges.push({ id: `e${k++}`, source: `n${col}_${row}`, target: `n${col + 1}_${(row * 3 + 1) % 8}`, width: 2 + (k % 10) });
  edges.push({ id: `e${k++}`, source: `n${col}_${row}`, target: `n${Math.min(7, col + 2)}_${(row + 5) % 8}`, width: 2 + (k % 7) });
}
const variants = JSON.parse(process.argv[2] || '[{}]');
for (const v of variants) {
  const t = performance.now(); routeGraph(Avoid, { nodes, edges }, v);
  console.log(JSON.stringify(v), (performance.now() - t).toFixed(0), 'ms');
}
