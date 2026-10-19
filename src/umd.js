// Entry for the <script> build: exposes `cytoscapeLibavoid` and registers
// itself when Cytoscape is already loaded as a global.
import register, * as api from './index.js';

if (typeof window !== 'undefined' && window.cytoscape) register(window.cytoscape);

export default Object.assign(register, api);
