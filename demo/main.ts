// Demo app: uses the TypeScript plugin from src/ exactly like
// another code base would - import, register, call cy.libavoid().
import cytoscape from 'cytoscape';
import type { ElementDefinition } from 'cytoscape';
import cytoscapeLibavoid from '../src';
import type { LibavoidOptions, RoutedEventInfo } from '../src';

cytoscape.use(cytoscapeLibavoid);

// small material flow: stores -> processes -> sinks, edge width = quantity
const nodes: Array<[id: string, label: string, x: number, y: number]> = [
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
const flows: Array<[source: string, target: string, quantity: number]> = [
  ['lager', 'saege', 18],
  ['lager', 'fraese', 10],
  ['zukauf', 'drehen', 12],
  ['zukauf', 'montage', 6],
  ['saege', 'montage', 14],
  ['saege', 'schrott', 3],
  ['fraese', 'montage', 8],
  ['fraese', 'lack', 2],
  ['drehen', 'lack', 9],
  ['drehen', 'schrott', 2],
  ['montage', 'versand', 22],
  ['lack', 'versand', 9],
  ['montage', 'lack', 4],
];
const elements: ElementDefinition[] = [
  ...nodes.map(([id, label, x, y]) => ({
    data: { id, label },
    position: { x, y },
    classes: id === 'qs' ? 'obstacle' : '',
  })),
  ...flows.map(([s, t, q]) => ({ data: { id: `${s}-${t}`, source: s, target: t, q } })),
];

const cy = cytoscape({
  container: document.getElementById('cy'),
  layout: { name: 'preset' },
  elements,
  style: [
    {
      selector: 'node',
      style: {
        shape: 'round-rectangle',
        width: 90,
        height: 70,
        'background-color': '#4a6fa5',
        label: 'data(label)',
        color: '#fff',
        'text-valign': 'center',
        'font-size': 12,
      },
    },
    { selector: 'node.obstacle', style: { 'background-color': '#b0b0b0', color: '#333' } },
    {
      selector: 'edge',
      style: {
        width: 'data(q)',
        'line-color': '#e08a2c',
        opacity: 0.75,
        'target-arrow-shape': 'triangle',
        'target-arrow-color': '#e08a2c',
        'arrow-scale': 0.6,
        'curve-style': 'taxi',
      },
    },
  ],
});

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const select = (id: string) => $<HTMLSelectElement>(id).value;
const read = (): Partial<LibavoidOptions> => ({
  ports: select('ports') as LibavoidOptions['ports'],
  routingType: select('routingType') as LibavoidOptions['routingType'],
  flowDirection: select('flowDirection') as LibavoidOptions['flowDirection'],
  cornerRadius: Number($<HTMLInputElement>('cornerRadius').value),
  rerouteOnDrag: $<HTMLInputElement>('rerouteOnDrag').checked,
});

const stats = $('stats');
// ?worker=1 routes in a Web Worker; the checkbox reloads the page with or without it
const useWorker = new URLSearchParams(location.search).has('worker');
const workerToggle = $<HTMLInputElement>('worker');
workerToggle.checked = useWorker;
workerToggle.addEventListener('change', () => {
  location.search = workerToggle.checked ? '?worker=1' : '';
});
const worker = useWorker ? new Worker('build/routing.worker.js', { type: 'module' }) : undefined;

const routing = cy.libavoid({ ...read(), wasmUrl: 'build/libavoid.wasm', worker });
routing.ready.catch((err: Error) => (stats.textContent = 'Fehler: ' + err.message));
cy.on('avoidrouted', (_evt, info: RoutedEventInfo) => {
  stats.textContent = `${info.edges} Kanten · Routing ${info.routingMs.toFixed(1)} ms · gesamt ${info.totalMs.toFixed(1)} ms`;
});

for (const id of ['ports', 'routingType', 'flowDirection', 'cornerRadius', 'rerouteOnDrag']) {
  $(id).addEventListener('input', () => routing.setOptions(read()));
}

let n = 0;
$('add').addEventListener('click', () => {
  const ext = cy.extent();
  cy.add({
    data: { id: `h${n}`, label: `Hindernis ${++n}` },
    classes: 'obstacle',
    position: { x: ext.x1 + Math.random() * ext.w, y: ext.y1 + Math.random() * ext.h },
  });
});
