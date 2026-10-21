import register, * as api from './index.js';
if (typeof window !== 'undefined' && window.cytoscape)
    register(window.cytoscape);
export default Object.assign(register, api);
//# sourceMappingURL=umd.js.map