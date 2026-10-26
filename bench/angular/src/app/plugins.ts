import cytoscape from 'cytoscape';
import type { Core, StylesheetJson } from 'cytoscape';
import cytoscapeLibavoid from './cytoscape-libavoid';
import gridGuide from 'cytoscape-grid-guide';
import expandCollapse from 'cytoscape-expand-collapse';
import nodeHtmlLabel from 'cytoscape-node-html-label';
import type { BenchConfig } from './config';
import { NODE_H, NODE_W } from './graph';

let registered = false;
export function registerPlugins(): void {
  if (registered) return;
  registered = true;
  cytoscape.use(cytoscapeLibavoid);
  cytoscape.use(gridGuide);
  cytoscape.use(expandCollapse);
  cytoscape.use(nodeHtmlLabel);
}

export function stylesheet(config: BenchConfig): StylesheetJson {
  const html = config.plugins.includes('htmlLabel');
  return [
    {
      selector: 'node.process',
      style: {
        shape: 'round-rectangle',
        width: NODE_W,
        height: NODE_H,
        'background-color': '#ffffff',
        'border-width': 1,
        'border-color': '#9aa5b1',
        label: html ? '' : 'data(name)',
        'text-valign': 'center',
        'font-size': 11,
      },
    },
    {
      selector: 'node.group, node:parent',
      style: {
        shape: 'round-rectangle',
        'background-color': '#eef2f6',
        'border-color': '#c3ccd5',
        'border-width': 1,
        padding: '16px',
        label: 'data(label)',
        'text-valign': 'top',
        'text-halign': 'center',
        'font-size': 11,
        color: '#52606d',
      },
    },
    {
      // collapsed groups (expand-collapse) become regular nodes
      selector: 'node.cy-expand-collapse-collapsed-node',
      style: { width: NODE_W, height: NODE_H, 'background-color': '#dfe6ee' },
    },
    {
      selector: 'edge',
      style: {
        width: 'data(flow)',
        'line-color': '#5b8def',
        opacity: 0.75,
        'curve-style': 'taxi', // baseline without libavoid; libavoid overrides this per edge
        'taxi-direction': 'horizontal',
        'target-arrow-shape': 'none',
      },
    },
  ];
}

/** SVG mini bar chart, like a node card showing live data. */
function nodeCard(d: { name: string; value: number; series: number[] }): string {
  const bars = d.series
    .map((v, i) => `<rect x="${i * 12}" y="${30 - v * 0.3}" width="9" height="${v * 0.3}" fill="${v > 80 ? '#e5484d' : '#5b8def'}"/>`)
    .join('');
  return `<div class="node-card"><div class="node-card__head"><b>${d.name}</b><span>${d.value}</span></div>`
    + `<svg width="96" height="30" viewBox="0 0 96 30">${bars}</svg></div>`;
}

/** Per-instance plugin setup, in the order a typical app does it. Resolves when everything is ready. */
export async function attachPlugins(cy: Core, config: BenchConfig): Promise<void> {
  const on = (p: string) => config.plugins.includes(p as never);

  if (on('htmlLabel')) {
    cy.nodeHtmlLabel([{ query: 'node.process', halign: 'center', valign: 'center', halignBox: 'center', valignBox: 'center', tpl: nodeCard }]);
  }
  if (on('gridGuide')) {
    // plugin defaults: snap to grid on release + draw grid
    cy.gridGuide({ gridSpacing: 20, snapToGridOnRelease: true, drawGrid: true });
  }
  if (on('expandCollapse')) {
    // plugin defaults apart from undo/redo (not installed)
    cy.expandCollapse({ layoutBy: null, fisheye: true, animate: true, animationDuration: 1000, undoable: false, cueEnabled: true });
  }
  if (on('libavoid')) {
    const routing = cy.libavoid({
      ports: config.ports,
      flowDirection: 'right',
      cornerRadius: config.cornerRadius,
      rerouteOnDrag: config.rerouteOnDrag,
      dragRouteInterval: config.dragRouteInterval,
      wasmUrl: 'libavoid.wasm', // copied next to index.html by angular.json
    });
    await routing.ready;
  }
}
