// Routing time of the EdgeRouter alone (no Cytoscape, no rendering), on the
// same material-flow graphs the Angular bench uses.
//
//   npm run perf                                  # size M, auto and docking ports
//   npm run perf -- L                             # size S / M / L
//   npm run perf -- M '[{"ports":"docking","shapeBufferDistance":4}]'
import { loadLibavoid } from '../src/libavoid';
import { EdgeRouter } from '../src/routing';
import type { GraphModel, RoutingOptions } from '../src/routing';
import { buildGraph, NODE_H, NODE_W, SIZES } from './angular/src/app/graph';

const RUNS = 5;
const [sizeName = 'M', variantsJson = '[{"ports":"auto"},{"ports":"docking"}]'] = process.argv.slice(2);
const size = SIZES[sizeName];
if (!size) throw new Error(`unknown size "${sizeName}", use one of ${Object.keys(SIZES).join(', ')}`);
const variants: Array<Partial<RoutingOptions>> = JSON.parse(variantsJson);

/** The process nodes and flows of the bench graph; groups are not obstacles. */
function benchModel(): GraphModel {
  const model: GraphModel = { nodes: [], edges: [] };
  for (const element of buildGraph(size)) {
    const data = element.data as { id: string; source?: string; target?: string; flow?: number };
    if (element.group === 'nodes' && element.position) {
      model.nodes.push({ id: data.id, ...element.position, width: NODE_W, height: NODE_H });
    } else if (element.group === 'edges' && data.source && data.target) {
      model.edges.push({ id: data.id, source: data.source, target: data.target, width: data.flow });
    }
  }
  return model;
}

const avoid = await loadLibavoid();
const model = benchModel();
console.log(`size ${sizeName}: ${model.nodes.length} nodes, ${model.edges.length} edges, mean of ${RUNS} runs`);
for (const variant of variants) {
  const router = new EdgeRouter(avoid, variant);
  router.route(model); // warm-up
  const start = performance.now();
  for (let i = 0; i < RUNS; i++) router.route(model);
  console.log(`  ${JSON.stringify(variant).padEnd(40)} ${((performance.now() - start) / RUNS).toFixed(1)} ms`);
}
