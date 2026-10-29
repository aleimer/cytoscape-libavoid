// Routing time of the EdgeRouter alone (no Cytoscape, no rendering), on the
// same material-flow graphs the Angular bench uses.
//
//   npm run perf                                  # size M, default options
//   npm run perf -- L                             # size S / M / L
//   npm run perf -- M '[{},{"shapeBufferDistance":4}]'
import { loadLibavoid } from '../src';
import { EdgeRouter } from '../src';
import type { RoutingOptions } from '../src';
import { benchModel } from './quality';

const RUNS = 5;
const [sizeName = 'M', variantsJson = '[{}]'] = process.argv.slice(2);
const variants: Array<Partial<RoutingOptions>> = JSON.parse(variantsJson);

const avoid = await loadLibavoid();
const model = benchModel(sizeName);
console.log(`size ${sizeName}: ${model.nodes.length} nodes, ${model.edges.length} edges, mean of ${RUNS} runs`);
for (const variant of variants) {
  const router = new EdgeRouter(avoid, variant);
  router.route(model); // warm-up
  const start = performance.now();
  for (let i = 0; i < RUNS; i++) router.route(model);
  console.log(`  ${JSON.stringify(variant).padEnd(40)} ${((performance.now() - start) / RUNS).toFixed(1)} ms`);
}
