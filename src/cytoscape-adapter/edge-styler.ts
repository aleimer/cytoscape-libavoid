// Applies routes to Cytoscape edges as style bypasses.

import type { Core, EdgeCollection, NodeSingular, SingularElementArgument } from 'cytoscape';
import type { Point } from '../shared/geometry';
import { routeToEdgeStyle, STYLE_PROPS } from './route-style';
import type { EdgeSegmentStyle, EdgeStyleOptions } from './route-style';

/** Applies routes to Cytoscape edges as style bypasses, and removes them again. */
export class EdgeStyler {
  private readonly cy: Core;
  /** Edge id -> element and style last applied to it, to skip edges whose route did not change. */
  private readonly applied = new Map<string, { element: unknown; style: EdgeSegmentStyle; styleKey: string }>();
  /**
   * Edge id -> the app's own bypasses of the hiding properties, restored when it is
   * shown, for the edges hidden by hide() until a route for their nodes' current
   * positions is applied.
   */
  private readonly hidden = new Map<string, Partial<Record<HidingProperty, string>>>();

  constructor(cy: Core) {
    this.cy = cy;
  }

  /**
   * Styles every routed edge and restores the edges that are no longer routed.
   *
   * @param nodePositions positions of the nodes when the routes were computed. The
   *   edge ends are anchored relative to them, so routes that arrive late (from a
   *   worker) still start and end at their nodes if those moved in the meantime.
   *   Missing nodes use their current position.
   */
  apply(
    routes: ReadonlyMap<string, readonly Point[]>,
    options: Partial<EdgeStyleOptions> = {},
    nodePositions: ReadonlyMap<string, Point> = new Map(),
  ): void {
    this.cy.batch(() => {
      for (const edgeId of [...this.applied.keys()]) {
        if (!routes.has(edgeId)) this.restore(edgeId);
      }
      for (const [edgeId, points] of routes) this.applyRoute(edgeId, points, options, nodePositions);
      this.revealInBatch(nodePositions);
    });
  }

  /** Hides the routed ones of these edges until reveal() or apply() finds their route up to date. */
  hide(edges: EdgeCollection): void {
    // only style what changes: with compound nodes every style update fires 'style' on all nodes
    const toHide = edges.filter((edge) => this.applied.has(edge.id()) && !this.hidden.has(edge.id()));
    if (toHide.empty()) return;
    this.cy.batch(() => {
      for (const edge of toHide.toArray()) {
        const bypasses: Partial<Record<HidingProperty, string>> = {};
        for (const property of HIDING_PROPERTIES) {
          const bypass = bypassOf(edge, property);
          if (bypass !== undefined) bypasses[property] = bypass;
          edge.style(property, 0);
        }
        this.hidden.set(edge.id(), bypasses);
      }
    });
  }

  /** Shows the hidden edges whose nodes are still where they were when the routes were computed. */
  reveal(nodePositions: ReadonlyMap<string, Point>): void {
    if (this.hidden.size) this.cy.batch(() => this.revealInBatch(nodePositions));
  }

  /** Restores the stylesheet style of every edge styled so far. */
  clear(): void {
    this.cy.batch(() => {
      for (const edgeId of [...this.applied.keys()]) this.restore(edgeId);
    });
  }

  private revealInBatch(nodePositions: ReadonlyMap<string, Point>): void {
    for (const edgeId of [...this.hidden.keys()]) {
      const edge = this.cy.getElementById(edgeId);
      if (edge.isEdge() && !(isAt(edge.source(), nodePositions) && isAt(edge.target(), nodePositions))) continue;
      this.show(edgeId);
    }
  }

  private show(edgeId: string): void {
    const edge = this.cy.getElementById(edgeId);
    const bypasses = this.hidden.get(edgeId) ?? {};
    for (const property of HIDING_PROPERTIES) {
      if (edge.empty()) break;
      const bypass = bypasses[property];
      if (bypass === undefined) edge.removeStyle(property);
      else edge.style(property, bypass);
    }
    this.hidden.delete(edgeId);
  }

  private applyRoute(
    edgeId: string,
    points: readonly Point[],
    options: Partial<EdgeStyleOptions>,
    nodePositions: ReadonlyMap<string, Point>,
  ): void {
    const edge = this.cy.getElementById(edgeId);
    if (!edge.isEdge()) return; // removed since the routes were computed
    const source = edge.source();
    const target = edge.target();
    const sourceCentre = nodePositions.get(source.id()) ?? source.position();
    const targetCentre = nodePositions.get(target.id()) ?? target.position();
    const style = routeToEdgeStyle(points, sourceCentre, targetCentre, options);
    if (!style) return;
    // every style update is costly and, with compound nodes, fires 'style' on all nodes
    const styleKey = JSON.stringify(style);
    const previous = this.applied.get(edgeId);
    if (previous && previous.element === edge[0] && previous.styleKey === styleKey) return;
    // e.g. corner radii or label margins that the new style does not set any more
    const leftOver = previous ? STYLE_PROPS.filter((prop) => prop in previous.style && !(prop in style)) : [];
    if (leftOver.length) edge.removeStyle(leftOver.join(' '));
    edge.style(style);
    this.applied.set(edgeId, { element: edge[0], style, styleKey });
  }

  private restore(edgeId: string): void {
    const edge = this.cy.getElementById(edgeId);
    if (edge.nonempty()) edge.removeStyle(STYLE_PROPS.join(' '));
    this.applied.delete(edgeId);
    if (this.hidden.has(edgeId)) this.show(edgeId);
  }
}

/**
 * A hidden edge keeps `opacity`, so Cytoscape still counts it as visible and it is
 * routed: `line-opacity` hides the line and both arrows (drawn with it), `text-opacity`
 * the label with its background.
 */
const HIDING_PROPERTIES = ['line-opacity', 'text-opacity'] as const;
type HidingProperty = (typeof HIDING_PROPERTIES)[number];

/**
 * The edge's bypass of a style property set by the app, if any. Cytoscape marks
 * bypassed properties on the parsed style that pstyle() returns; neither is in its typings.
 */
function bypassOf(edge: SingularElementArgument, property: string): string | undefined {
  const parsed = (
    edge as unknown as { pstyle(name: string): { bypass?: boolean; strValue?: string } | undefined }
  ).pstyle(property);
  return parsed?.bypass ? parsed.strValue : undefined;
}

/** Is the node where it was when the routes were computed? */
function isAt(node: NodeSingular, nodePositions: ReadonlyMap<string, Point>): boolean {
  const routed = nodePositions.get(node.id());
  const { x, y } = node.position();
  return routed !== undefined && routed.x === x && routed.y === y;
}
