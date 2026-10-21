// Entry for the <script> build: exposes `cytoscapeLibavoid` and registers
// itself when Cytoscape is already loaded as a global.
import type cytoscape from 'cytoscape';
import register, * as api from './index.ts';

declare global {
  interface Window {
    cytoscape?: typeof cytoscape;
  }
}

if (typeof window !== 'undefined' && window.cytoscape) register(window.cytoscape);

export default Object.assign(register, api);
