/**
 * Draws routes on Cytoscape edges as style bypasses, store-style: the public
 * methods only change what each edge should look like (`wanted`), and render()
 * alone writes the difference to Cytoscape. So no method has to know what another
 * one left on an edge, e.g. that removing a route must also undo hiding.
 */

import type { Core, EdgeCollection, NodeSingular, SingularElementArgument } from 'cytoscape';
import type { Point } from '../shared/geometry';
import { SEGMENT_STYLE_PROPERTIES, segmentStyleFor } from './route-style';
import type { EdgeSegmentStyle, EdgeStyleOptions } from './route-style';

/** A route style together with its serialised form, to compare styles cheaply. */
interface RouteLook
{
  /** The style bypass, see {@link segmentStyleFor}. */
  style: EdgeSegmentStyle;
  /** `style` as JSON; equal keys mean equal styles. */
  key: string;
}

/** What one edge should look like; an edge with neither is left to the stylesheet. */
interface WantedLook
{
  /** The segments style that draws its route. */
  route: RouteLook | undefined;
  /** Invisible until its route is up to date again, see `hideEdgesOnDrag`. */
  hidden: boolean;
}

/** What {@link EdgeStyler.render} has written to one edge. */
interface WrittenLook
{
  /** The element written to: an edge removed and added again with the same id is a new element without it. */
  element: unknown;
  /** The route style on the edge now. */
  route: RouteLook | undefined;
  /** Set while hidden: the app's own bypasses of {@link HIDING_PROPERTIES}, to give back when it is shown again. */
  hiddenOver: Partial<Record<HidingProperty, string>> | undefined;
}

/** The wanted look of an edge the plugin leaves alone. */
const NOTHING_WANTED: Readonly<WantedLook> = Object.freeze({ route: undefined, hidden: false });

/** Draws routes on Cytoscape edges as style bypasses, hides edges while their route is stale, and undoes both. */
export class EdgeStyler
{
  /** The graph whose edges are styled. */
  private readonly cy: Core;
  /** State: edge id -> what it should look like. Only the public methods change it. */
  private readonly wanted = new Map<string, WantedLook>();
  /** Edge id -> what is written to it now. Only {@link EdgeStyler.render} changes it. */
  private readonly written = new Map<string, WrittenLook>();
  /** The edges whose `wanted` look changed since the last render(). */
  private readonly dirty = new Set<string>();

  /** @param cy the graph whose edges are styled */
  constructor(cy: Core)
  {
    this.cy = cy;
  }

  /**
   * Draws every routed edge along its route, gives the edges that are no longer
   * routed their own look back, and shows the hidden edges whose route is now up to date.
   *
   * @param routes        edge id -> route points; edges not in it lose their route style
   * @param options       corner radius and label position, see {@link segmentStyleFor}
   * @param nodePositions positions of the nodes when the routes were computed. The
   *   edge ends are anchored relative to them, so routes that arrive late (from a
   *   worker) still start and end at their nodes if those moved in the meantime.
   *   Missing nodes use their current position.
   */
  setRoutes(
    routes: ReadonlyMap<string, readonly Point[]>,
    options: Partial<EdgeStyleOptions> = {},
    nodePositions: ReadonlyMap<string, Point> = new Map(),
  ): void
  {
    for (const edgeId of this.wanted.keys())
    {
      if (!routes.has(edgeId))
      {
        this.want(edgeId, NOTHING_WANTED);
      }
    }
    for (const [edgeId, points] of routes)
    {
      const edge = this.cy.getElementById(edgeId);
      if (!edge.isEdge())
      {
        continue; // removed since the routes were computed
      }
      const source = edge.source();
      const target = edge.target();
      const sourceCentre = nodePositions.get(source.id()) ?? source.position();
      const targetCentre = nodePositions.get(target.id()) ?? target.position();
      const style = segmentStyleFor(points, sourceCentre, targetCentre, options);
      if (style)
      {
        this.want(edgeId, { route: { style, key: JSON.stringify(style) } });
      }
    }
    this.markUpToDateVisible(nodePositions);
    this.render();
  }

  /**
   * Hides edges until {@link EdgeStyler.setRoutes} or {@link EdgeStyler.unhideUpToDate}
   * finds their route up to date.
   *
   * @param edges the edges to hide; only those with a route style are hidden
   */
  hide(edges: EdgeCollection): void
  {
    for (const edge of edges.toArray())
    {
      const wanted = this.wanted.get(edge.id());
      if (wanted?.route && !wanted.hidden)
      {
        this.want(edge.id(), { hidden: true });
      }
    }
    this.render();
  }

  /**
   * Shows the hidden edges whose nodes are still where they were when the routes were computed.
   *
   * @param nodePositions the node positions the current routes were computed for
   */
  unhideUpToDate(nodePositions: ReadonlyMap<string, Point>): void
  {
    this.markUpToDateVisible(nodePositions);
    this.render();
  }

  /** Gives every edge styled so far its own look from the stylesheet back. */
  reset(): void
  {
    for (const edgeId of this.wanted.keys())
    {
      this.want(edgeId, NOTHING_WANTED);
    }
    this.render();
  }

  /**
   * Changes the wanted look of an edge, to be written by the next {@link EdgeStyler.render}.
   *
   * @param edgeId the edge
   * @param change the fields to change; the others keep their wanted value
   */
  private want(edgeId: string, change: Partial<WantedLook>): void
  {
    this.wanted.set(edgeId, { ...(this.wanted.get(edgeId) ?? NOTHING_WANTED), ...change });
    this.dirty.add(edgeId);
  }

  /**
   * Marks the hidden edges as visible whose nodes are where they were routed, or which are gone.
   *
   * @param nodePositions the node positions the current routes were computed for
   */
  private markUpToDateVisible(nodePositions: ReadonlyMap<string, Point>): void
  {
    for (const [edgeId, wanted] of this.wanted)
    {
      if (!wanted.hidden)
      {
        continue;
      }
      const edge = this.cy.getElementById(edgeId);
      if (!edge.isEdge() || !(hasMoved(edge.source(), nodePositions) || hasMoved(edge.target(), nodePositions)))
      {
        this.want(edgeId, { hidden: false });
      }
    }
  }

  /**
   * Writes the difference between the wanted and the written look of the changed
   * edges, in one batch. Only what differs is written: every style update is costly
   * and, with compound nodes, fires `style` on all nodes.
   */
  private render(): void
  {
    if (this.dirty.size === 0)
    {
      return;
    }
    this.cy.batch(() =>
    {
      for (const edgeId of this.dirty)
      {
        this.renderEdge(edgeId);
      }
    });
    this.dirty.clear();
  }

  /**
   * Writes the difference for one edge and updates its records; an edge that is
   * gone or needs nothing any more is forgotten.
   *
   * @param edgeId a dirty edge
   */
  private renderEdge(edgeId: string): void
  {
    const wanted = this.wanted.get(edgeId) ?? NOTHING_WANTED;
    const edge = this.cy.getElementById(edgeId);
    if (!edge.isEdge())
    {
      // gone: nothing to write to; a new edge with this id starts from the stylesheet
      this.written.delete(edgeId);
      this.forgetIfNothingWanted(edgeId, wanted);
      return;
    }
    const previous = this.written.get(edgeId);
    const written: WrittenLook = previous && previous.element === edge[0] ?
      { ...previous } :
      { element: edge[0], route: undefined, hiddenOver: undefined };

    if (wanted.route?.key !== written.route?.key)
    {
      writeRoute(edge, written.route, wanted.route);
      written.route = wanted.route;
    }
    if (wanted.hidden && !written.hiddenOver)
    {
      written.hiddenOver = hideEdge(edge);
    }
    else if (!wanted.hidden && written.hiddenOver)
    {
      unhideEdge(edge, written.hiddenOver);
      written.hiddenOver = undefined;
    }

    if (written.route || written.hiddenOver)
    {
      this.written.set(edgeId, written);
    }
    else
    {
      this.written.delete(edgeId);
    }
    this.forgetIfNothingWanted(edgeId, wanted);
  }

  /**
   * Drops an edge's wanted look once it is {@link NOTHING_WANTED}, so the map does not grow.
   *
   * @param edgeId the edge
   * @param wanted its wanted look
   */
  private forgetIfNothingWanted(edgeId: string, wanted: WantedLook): void
  {
    if (!wanted.route && !wanted.hidden)
    {
      this.wanted.delete(edgeId);
    }
  }
}

/**
 * Replaces the written route style with the wanted one. Removes properties the new
 * style does not set any more, e.g. corner radii or label margins.
 *
 * @param edge the edge to write to
 * @param from the route style on it now, if any
 * @param to   the route style to write; undefined = the stylesheet's own line
 */
function writeRoute(edge: SingularElementArgument, from: RouteLook | undefined, to: RouteLook | undefined): void
{
  if (!to)
  {
    edge.removeStyle(SEGMENT_STYLE_PROPERTIES.join(' '));
    return;
  }
  const leftOver = from ?
    SEGMENT_STYLE_PROPERTIES.filter((property) => property in from.style && !(property in to.style)) :
    [];
  if (leftOver.length)
  {
    edge.removeStyle(leftOver.join(' '));
  }
  edge.style(to.style);
}

/**
 * A hidden edge keeps `opacity`, so Cytoscape still counts it as visible and it is
 * routed: `line-opacity` hides the line and both arrows (drawn with it), `text-opacity`
 * the label with its background.
 */
const HIDING_PROPERTIES = ['line-opacity', 'text-opacity'] as const;
/** One of {@link HIDING_PROPERTIES}. */
type HidingProperty = (typeof HIDING_PROPERTIES)[number];

/**
 * Makes an edge invisible.
 *
 * @param edge the edge to hide
 * @returns the app's own bypasses of the hiding properties, for {@link unhideEdge}
 */
function hideEdge(edge: SingularElementArgument): Partial<Record<HidingProperty, string>>
{
  const appBypasses: Partial<Record<HidingProperty, string>> = {};
  for (const property of HIDING_PROPERTIES)
  {
    const bypass = bypassOf(edge, property);
    if (bypass !== undefined)
    {
      appBypasses[property] = bypass;
    }
    edge.style(property, 0);
  }
  return appBypasses;
}

/**
 * Makes a hidden edge visible again.
 *
 * @param edge        the edge to show
 * @param appBypasses what {@link hideEdge} returned for it; properties without one go back to the stylesheet
 */
function unhideEdge(edge: SingularElementArgument, appBypasses: Partial<Record<HidingProperty, string>>): void
{
  for (const property of HIDING_PROPERTIES)
  {
    const bypass = appBypasses[property];
    if (bypass === undefined)
    {
      edge.removeStyle(property);
    }
    else
    {
      edge.style(property, bypass);
    }
  }
}

/**
 * The edge's bypass of a style property set by the app. Cytoscape marks bypassed
 * properties on the parsed style that pstyle() returns; neither is in its typings.
 *
 * @param edge     the edge
 * @param property a style property name
 * @returns the bypass value as text, or undefined if the property comes from the stylesheet
 */
function bypassOf(edge: SingularElementArgument, property: string): string | undefined
{
  const parsed = (
    edge as unknown as { pstyle(name: string): { bypass?: boolean; strValue?: string; } | undefined; }
  ).pstyle(property);
  return parsed?.bypass ? parsed.strValue : undefined;
}

/**
 * Whether a node has moved since the routes were computed.
 *
 * @param node            the node
 * @param routedPositions node id -> position when the routes were computed
 * @returns true if it is elsewhere now; a node without a routed position counts as moved
 */
function hasMoved(node: NodeSingular, routedPositions: ReadonlyMap<string, Point>): boolean
{
  const routed = routedPositions.get(node.id());
  const { x, y } = node.position();
  return routed === undefined || routed.x !== x || routed.y !== y;
}
