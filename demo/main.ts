// Demo app: uses the TypeScript plugin from src/ exactly like
// another code base would - import, register, call cy.libavoid().
import cytoscape from 'cytoscape';
import type { EdgeSingular, ElementDefinition } from 'cytoscape';
import cytoscapeLibavoid from '../src';
import type { LibavoidOptions, RoutedEventInfo } from '../src';
import { flowLabel, flowWidth } from './flow-width';
import {
  DEFAULT_PLANT_SCALE,
  isCollapsible,
  PLANT_MAX_QUANTITY,
  PLANT_MAX_WIDTH,
  plantPositions,
  plantView,
} from './plant-graph';
import { SMALL_FLOWS, SMALL_MAX_QUANTITY, SMALL_MAX_WIDTH, SMALL_NODE_SIZE, SMALL_NODES } from './small-graph';

cytoscape.use(cytoscapeLibavoid);

const smallElements: ElementDefinition[] = [
  ...SMALL_NODES.map(([id, label, x, y]) => ({
    data: { id, label },
    position: { x, y },
    classes: id === 'qs' ? 'obstacle' : '',
  })),
  ...SMALL_FLOWS.map(([s, t, q]) => ({ data: { id: `${s}-${t}`, source: s, target: t, q } })),
];

// ?graph=plant: the steel plant of plant-graph.ts, with many crowded gaps and
// groups; a double click collapses or expands a group
const params = new URLSearchParams(location.search);
const plant = params.get('graph') === 'plant';
const collapsed = new Set<string>();
/** Plant node positions, updated from the graph so a collapse keeps what was dragged. */
const plantNodePositions = new Map(plantPositions().map(({ id, x, y }) => [id, { x, y }]));
function plantElements(): ElementDefinition[]
{
  const view = plantView(collapsed, plantNodePositions);
  return [
    ...view.groups.map(({ id, parent, collapsible }) => ({
      data: { id, label: id, parent },
      classes: collapsible ? 'group collapsible' : 'group',
    })),
    ...view.nodes.map(({ id, x, y, parent, collapsed: isGroup }) => ({
      data: { id, label: isGroup ? `${id} +` : id, parent },
      position: { x, y },
      classes: isGroup ? 'plant collapsed' : 'plant',
    })),
    ...view.edges.map(({ id, source, target, quantity }) => ({ data: { id, source, target, q: quantity } })),
  ];
}
const elements = plant ? plantElements() : smallElements;
const [maxQuantity, maxWidth] = plant ? [PLANT_MAX_QUANTITY, PLANT_MAX_WIDTH] : [SMALL_MAX_QUANTITY, SMALL_MAX_WIDTH];

const cy = cytoscape({
  container: document.getElementById('cy'),
  layout: { name: 'preset' },
  elements,
  style: [
    {
      selector: 'node',
      style: {
        shape: 'round-rectangle',
        width: SMALL_NODE_SIZE.width,
        height: SMALL_NODE_SIZE.height,
        'background-color': '#4a6fa5',
        label: 'data(label)',
        color: '#fff',
        'text-valign': 'center',
        'font-size': 12,
      },
    },
    { selector: 'node.obstacle', style: { 'background-color': '#b0b0b0', color: '#333' } },
    {
      selector: 'node.plant',
      style: { width: DEFAULT_PLANT_SCALE.nodeWidth, height: DEFAULT_PLANT_SCALE.nodeHeight, 'font-size': 10 },
    },
    {
      selector: 'node.collapsed',
      style: { 'background-color': '#2f4d78', 'border-width': 2, 'border-color': '#1b2f4d' },
    },
    {
      selector: 'node.group',
      style: {
        'background-color': '#4a6fa5',
        'background-opacity': 0.06,
        'border-width': 1,
        'border-style': 'dashed',
        'border-color': '#7d8fa8',
        color: '#4a5568',
        'text-valign': 'top',
        'text-halign': 'center',
        'font-size': 11,
        padding: '12px',
      },
    },
    { selector: 'node.group.collapsible', style: { 'border-style': 'solid', 'background-opacity': 0.1 } },
    {
      selector: 'edge',
      style: {
        // routing spaces parallel edges by this width
        width: (edge: EdgeSingular) => flowWidth(Number(edge.data('q')), maxQuantity, maxWidth),
        'line-color': '#e08a2c',
        opacity: 0.75,
        'target-arrow-shape': 'triangle',
        'target-arrow-color': '#e08a2c',
        'arrow-scale': 0.6,
        'curve-style': 'taxi',
        label: (edge: EdgeSingular) => flowLabel(Number(edge.data('q'))),
        'font-size': 10,
        color: '#7a4a12',
        'text-background-color': '#fafafa',
        'text-background-opacity': 0.85,
        'text-background-padding': '1px',
      },
    },
  ],
});

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const read = (): Partial<LibavoidOptions> => ({
  rerouteOnDrag: $<HTMLInputElement>('rerouteOnDrag').checked,
  dragRouteDelay: Math.max(0, Number($<HTMLInputElement>('dragRouteDelay').value) || 0),
  hideEdgesOnDrag: $<HTMLInputElement>('hideEdgesOnDrag').checked,
  labelPosition: $<HTMLInputElement>('labelPosition').checked ? 'longest-segment' : 'middle',
});

const stats = $('stats');
// ?worker=1 routes in a Web Worker; the checkbox reloads the page with or without it
const useWorker = params.has('worker');
const workerToggle = $<HTMLInputElement>('worker');
workerToggle.checked = useWorker;
const reloadWith = (key: string, value: string | undefined): void =>
{
  if (value === undefined)
  {
    params.delete(key);
  }
  else
  {
    params.set(key, value);
  }
  location.search = params.toString();
};
workerToggle.addEventListener('change', () => reloadWith('worker', workerToggle.checked ? '1' : undefined));
const graphSelect = $<HTMLSelectElement>('graph');
graphSelect.value = plant ? 'plant' : 'small';
graphSelect.addEventListener('change', () => reloadWith('graph', graphSelect.value === 'plant' ? 'plant' : undefined));
const worker = useWorker ? new Worker('build/routing.worker.js', { type: 'module' }) : undefined;

const routing = cy.libavoid({ ...read(), wasmUrl: 'build/libavoid.wasm', worker });
// for trying things out in the browser console
Object.assign(window, { demo: { cy, routing } });
routing.ready.catch((err: Error) => (stats.textContent = 'Fehler: ' + err.message));
cy.on('avoidrouted', (_evt, info: RoutedEventInfo) =>
{
  stats.textContent = `${info.edges} Kanten · Routing ${info.routingMs.toFixed(1)} ms · gesamt ${
    info.totalMs.toFixed(1)
  } ms`;
});

if (plant)
{
  cy.on('dbltap', 'node.collapsible, node.collapsed', (event) =>
  {
    const id: string = event.target.id();
    if (!isCollapsible(id))
    {
      return;
    }
    for (const node of cy.nodes('.plant:childless').toArray())
    {
      if (!node.hasClass('collapsed'))
      {
        plantNodePositions.set(node.id(), { ...node.position() });
      }
    }
    if (collapsed.has(id))
    {
      collapsed.delete(id);
    }
    else
    {
      collapsed.add(id);
    }
    cy.batch(() =>
    {
      cy.elements().remove();
      cy.add(plantElements());
    });
  });
}

for (const id of ['rerouteOnDrag', 'dragRouteDelay', 'hideEdgesOnDrag', 'labelPosition'])
{
  $(id).addEventListener('input', () => routing.setOptions(read()));
}
