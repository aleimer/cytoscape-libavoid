// Spreads apart parallel segments that lie on top of each other, see route-geometry.ts.

import type { Point } from '../shared/geometry';
import type { GraphModel } from '../shared/graph';
import { RouteGeometry } from './route-geometry';
import { MIN_SHARED_RUN } from './run';
import type { Run } from './run';

const MAX_PASSES = 4;
/**
 * A bundle that does not fit is squeezed in steps of 1/SQUEEZE_STEPS of its ideal
 * width, down to MIN_SQUEEZE_STEPS of them; below that it stays as it is.
 */
const SQUEEZE_STEPS = 10;
const MIN_SQUEEZE_STEPS = 2;

/**
 * Spreads apart parallel segments of different edges whose strokes overlap; changes
 * `geometry` in place. Orthogonal routes only; other segments are left as they are.
 *
 * @param spacing gap kept between neighbouring strokes (px)
 */
export function separateOverlapsIn(geometry: RouteGeometry, spacing: number): void {
  new OverlapSeparator(geometry, spacing).separate();
}

/**
 * separateOverlapsIn() for plain routes.
 *
 * @returns new routes; the input is not changed
 */
export function separateOverlaps(
  routes: ReadonlyMap<string, readonly Point[]>,
  model: GraphModel,
  spacing: number,
): Map<string, Point[]> {
  const geometry = new RouteGeometry(routes, model);
  separateOverlapsIn(geometry, spacing);
  return geometry.routes;
}

class OverlapSeparator {
  private readonly geometry: RouteGeometry;
  private readonly spacing: number;
  /** The runs of each route, to find the segments a moved run stretches. */
  private readonly runsByRoute = new Map<Point[], Run[]>();

  constructor(geometry: RouteGeometry, spacing: number) {
    this.geometry = geometry;
    this.spacing = spacing;
    for (const run of geometry.runs) {
      this.runsByRoute.set(run.route, [...(this.runsByRoute.get(run.route) ?? []), run]);
    }
  }

  separate(): void {
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      let improved = false;
      for (const bundle of this.geometry.overlappingBundles()) {
        if (!bundle.some((run) => run.movable)) continue;
        if (this.separateBundle(bundle)) improved = true;
      }
      if (!improved) break;
    }
  }

  /** Moves a bundle apart if that reduces the overlaps around it; returns whether it moved. */
  private separateBundle(bundle: Run[]): boolean {
    bundle.sort(compareInBundle);
    const positions = this.spread(bundle);
    if (!positions) return false;
    const affected = this.withStretchedNeighbours(bundle);
    const before = this.overlapsOf(affected);
    const previous = bundle.map((run) => run.position);
    this.moveBundle(bundle, positions);
    if (this.overlapsOf(affected) < before - MIN_SHARED_RUN) return true;
    this.moveBundle(bundle, previous);
    return false;
  }

  /** The runs of a bundle and the segments next to them, which moving the bundle stretches. */
  private withStretchedNeighbours(bundle: Run[]): Set<Run> {
    const affected = new Set<Run>(bundle);
    for (const run of bundle) {
      for (const neighbour of this.runsByRoute.get(run.route) ?? []) {
        if (Math.abs(neighbour.index - run.index) === 1) affected.add(neighbour);
      }
    }
    return affected;
  }

  /** Total length along which these runs overlap others. */
  private overlapsOf(runs: Set<Run>): number {
    let total = 0;
    for (const run of runs) for (const near of this.geometry.overlapping(run)) total += run.overlapLength(near);
    return total;
  }

  private moveBundle(bundle: Run[], positions: number[]): void {
    bundle.forEach((run, i) => {
      if (run.movable) this.geometry.move(run, positions[i]!);
    });
  }

  /** New positions for a bundle, spread by width and spacing and kept inside every run's free interval. */
  private spread(bundle: Run[]): number[] | undefined {
    const offsets = [0];
    for (let i = 1; i < bundle.length; i++) {
      offsets.push(offsets[i - 1]! + (bundle[i - 1]!.width + bundle[i]!.width) / 2 + this.spacing);
    }
    const span = offsets[offsets.length - 1]!;
    const centre = bundle.reduce((sum, run) => sum + run.position, 0) / bundle.length;
    const intervals = bundle.map((run) => this.geometry.freeInterval(run));

    // the full spread if it fits, otherwise squeezed as little as possible
    for (let steps = SQUEEZE_STEPS; steps >= MIN_SQUEEZE_STEPS; steps--) {
      const squeeze = steps / SQUEEZE_STEPS;
      const wanted = offsets.map((offset) => centre + (offset - span / 2) * squeeze);
      let shiftLow = -Infinity;
      let shiftHigh = Infinity;
      intervals.forEach(([low, high], i) => {
        shiftLow = Math.max(shiftLow, low - wanted[i]!);
        shiftHigh = Math.min(shiftHigh, high - wanted[i]!);
      });
      if (shiftLow <= shiftHigh) {
        const shift = Math.min(shiftHigh, Math.max(shiftLow, 0));
        return wanted.map((position) => position + shift);
      }
    }
    return undefined;
  }
}

/**
 * Order of the runs of a bundle across the axis. Runs keep libavoid's order;
 * runs on the same line are ordered by where their neighbours go, so a run
 * whose neighbours lead towards lower coordinates comes first.
 */
function compareInBundle(a: Run, b: Run): number {
  const lean = (run: Run): number => {
    const { position } = run;
    const before = run.route[run.index - 1]?.[run.axis] ?? position;
    const after = run.route[run.index + 2]?.[run.axis] ?? position;
    return Math.sign(before - position) + Math.sign(after - position);
  };
  return a.position - b.position || lean(a) - lean(b) || a.edgeId.localeCompare(b.edgeId);
}
