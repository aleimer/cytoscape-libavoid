/**
 * Whether a node is being dragged, without selecting `:grabbed` over the whole
 * graph on every change event.
 */

import type { Core, EventObject, NodeSingular } from 'cytoscape';

/** The grabbed nodes, kept up to date from `grab`, `free` and `remove` events. */
export class DragTracker
{
  private readonly grabbed = new Set<NodeSingular>();

  /** Starts with the nodes grabbed now, e.g. when listening starts during a drag. */
  reset(cy: Core): void
  {
    this.grabbed.clear();
    for (const node of cy.nodes(':grabbed').toArray())
    {
      this.grabbed.add(node);
    }
  }

  /** True while a node is grabbed. Re-checks the tracked nodes, so a missed `free` does not stick. */
  get active(): boolean
  {
    for (const node of this.grabbed)
    {
      if (!node.removed() && node.grabbed())
      {
        return true;
      }
      this.grabbed.delete(node);
    }
    return false;
  }

  /** For `grab`. */
  readonly onGrab = (event: EventObject): void =>
  {
    this.grabbed.add(event.target as NodeSingular);
  };

  /** For `free` and `remove`. */
  readonly onRelease = (event: EventObject): void =>
  {
    this.grabbed.delete(event.target as NodeSingular);
  };
}
