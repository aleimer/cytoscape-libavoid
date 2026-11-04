/**
 * When to re-route: one run per animation frame at most, and while a node is
 * dragged after a rest (`dragRouteDelay`) and a pause (`dragRouteInterval`).
 * Knows nothing about Cytoscape or routing; its owner supplies both.
 */

/** What the scheduler asks its owner each time, so changed options apply at once. */
export interface ScheduleTiming
{
  /** @returns true while a node is being dragged */
  dragging(): boolean;
  /** @returns while dragging: how long the changes must rest before a run (ms); 0 = no rest */
  restDelay(): number;
  /** @returns while dragging: how long to wait before the next run (ms); <= 0 = no pause */
  pause(): number;
}

/**
 * Calls back in the next animation frame: requestAnimationFrame in the browser,
 * a timer in Node.js (tests).
 *
 * @param callback called once
 */
const nextFrame: (callback: () => void) => void = typeof requestAnimationFrame === 'function' ?
  (callback) => requestAnimationFrame(callback) :
  (callback) => setTimeout(callback, 0);

/** Coalesces many {@link RouteScheduler.schedule} calls into one call of `run`. */
export class RouteScheduler
{
  /** Asked on every schedule, see {@link ScheduleTiming}. */
  private readonly timing: ScheduleTiming;
  /** What a scheduled run calls. */
  private readonly run: () => void;
  /** A run is waiting for its frame (or its pause); further schedule() calls join it. */
  private pending = false;
  /** Waits for the changes to rest while dragging; restarted by every schedule(). */
  private restTimer: ReturnType<typeof setTimeout> | undefined;
  /** Set by {@link RouteScheduler.stop}; nothing runs any more. */
  private stopped = false;

  /**
   * @param timing asked on every schedule, so changed options apply at once
   * @param run    called for each scheduled run
   */
  constructor(timing: ScheduleTiming, run: () => void)
  {
    this.timing = timing;
    this.run = run;
  }

  /**
   * Asks for a run. Without a drag it comes in the next frame. While dragging it
   * waits until no schedule() call came for `restDelay()`, then for `pause()`.
   */
  schedule(): void
  {
    if (this.stopped)
    {
      return;
    }
    clearTimeout(this.restTimer);
    this.restTimer = undefined;
    const delay = this.timing.dragging() ? this.timing.restDelay() : 0;
    if (delay > 0)
    {
      this.restTimer = setTimeout(() =>
      {
        this.restTimer = undefined;
        this.scheduleInFrame();
      }, delay);
      return;
    }
    this.scheduleInFrame();
  }

  /** Drops what is scheduled; later {@link RouteScheduler.schedule} calls do nothing. */
  stop(): void
  {
    this.stopped = true;
    clearTimeout(this.restTimer);
  }

  /**
   * Runs in the next frame, after the drag pause if any; joins a run already
   * waiting instead of adding a second one.
   */
  private scheduleInFrame(): void
  {
    if (this.pending)
    {
      return;
    }
    this.pending = true;
    const runInNextFrame = () =>
      nextFrame(() =>
      {
        this.pending = false;
        // a drag that started meanwhile waits for the rest, e.g. after the style events of a mousedown
        if (!this.stopped && this.restTimer === undefined)
        {
          this.run();
        }
      });
    const pause = this.timing.dragging() ? this.timing.pause() : 0;
    if (pause > 0)
    {
      setTimeout(runInNextFrame, pause);
    }
    else
    {
      runInNextFrame();
    }
  }
}
