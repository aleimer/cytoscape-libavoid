// When to re-route: one run per animation frame at most, and while a node is
// dragged after a rest (`dragRouteDelay`) and a pause (`dragRouteInterval`).
// Knows nothing about Cytoscape or routing, LibavoidRouting supplies both.

export interface ScheduleTiming {
  /** A node is being dragged. */
  dragging(): boolean;
  /** While dragging: how long the changes must rest before a run (ms); 0 = no rest. */
  restDelay(): number;
  /** While dragging: how long to wait before the next run (ms); <= 0 = no pause. */
  pause(): number;
}

const nextFrame: (callback: () => void) => void =
  typeof requestAnimationFrame === 'function'
    ? (callback) => requestAnimationFrame(callback)
    : (callback) => setTimeout(callback, 0);

/** Coalesces many schedule() calls into one call of `run`. */
export class RouteScheduler {
  private readonly timing: ScheduleTiming;
  private readonly run: () => void;
  /** A run is waiting for its frame (or pause). */
  private pending = false;
  /** Waits for the changes to rest while dragging; restarted by every schedule(). */
  private restTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(timing: ScheduleTiming, run: () => void) {
    this.timing = timing;
    this.run = run;
  }

  schedule(): void {
    if (this.stopped) return;
    clearTimeout(this.restTimer);
    this.restTimer = undefined;
    const delay = this.timing.dragging() ? this.timing.restDelay() : 0;
    if (delay > 0) {
      this.restTimer = setTimeout(() => {
        this.restTimer = undefined;
        this.scheduleInFrame();
      }, delay);
      return;
    }
    this.scheduleInFrame();
  }

  /** Drops what is scheduled; later schedule() calls do nothing. */
  stop(): void {
    this.stopped = true;
    clearTimeout(this.restTimer);
  }

  private scheduleInFrame(): void {
    if (this.pending) return;
    this.pending = true;
    const runInNextFrame = () =>
      nextFrame(() => {
        this.pending = false;
        // a drag that started meanwhile waits for the rest, e.g. after the style events of a mousedown
        if (!this.stopped && this.restTimer === undefined) this.run();
      });
    const pause = this.timing.dragging() ? this.timing.pause() : 0;
    if (pause > 0) setTimeout(runInNextFrame, pause);
    else runInNextFrame();
  }
}
