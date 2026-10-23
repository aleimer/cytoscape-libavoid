// Core methods added by the plugins (module declarations: cytoscape-plugin-modules.d.ts).
import 'cytoscape';

declare module 'cytoscape' {
  interface NodeHtmlLabelParams {
    query?: string;
    halign?: 'left' | 'center' | 'right';
    valign?: 'top' | 'center' | 'bottom';
    halignBox?: 'left' | 'center' | 'right';
    valignBox?: 'top' | 'center' | 'bottom';
    cssClass?: string;
    tpl?: (data: any) => string;
  }

  interface ExpandCollapseApi {
    collapseAll(options?: object): void;
    expandAll(options?: object): void;
    collapse(nodes: NodeCollection, options?: object): void;
    expand(nodes: NodeCollection, options?: object): void;
  }

  interface Core {
    gridGuide(options?: object): unknown;
    expandCollapse(options?: object): ExpandCollapseApi;
    nodeHtmlLabel(params: NodeHtmlLabelParams[], options?: { enablePointerEvents?: boolean }): Core;
  }
}
