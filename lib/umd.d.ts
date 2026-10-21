import type cytoscape from 'cytoscape';
import register, * as api from './index.ts';
declare global {
    interface Window {
        cytoscape?: typeof cytoscape;
    }
}
declare const _default: typeof register & typeof api;
export default _default;
//# sourceMappingURL=umd.d.ts.map