// Spatial index of runs, so neighbouring runs are found without comparing all pairs.

import type { Axis } from '../shared/geometry';
import type { Run } from './run';
import { roundCoordinate } from './simplify';

/**
 * Runs bucketed by axis and position, so the runs near a position are found
 * without comparing all pairs. Runs are only moved through the index, so it
 * never gets out of date.
 */
export class RunIndex {
  /** The widest stroke: runs further apart than half of it plus half their own width cannot touch. */
  readonly maxWidth: number;
  private readonly bucketSize: number;
  private readonly buckets = new Map<string, Set<Run>>();

  constructor(runs: readonly Run[]) {
    this.maxWidth = runs.reduce((max, run) => Math.max(max, run.width), 0);
    this.bucketSize = this.maxWidth + 1;
    for (const run of runs) this.add(run);
  }

  /** Runs on `axis` positioned between `low` and `high` (and a few just outside). */
  between(axis: Axis, low: number, high: number): Run[] {
    const found: Run[] = [];
    const last = this.bucketOf(high);
    for (let bucket = this.bucketOf(low); bucket <= last; bucket++) {
      for (const run of this.buckets.get(`${axis}${bucket}`) ?? []) found.push(run);
    }
    return found;
  }

  /** Runs that overlap the given one. */
  overlapping(run: Run): Run[] {
    const reach = (run.width + this.maxWidth) / 2;
    const { position } = run;
    return this.between(run.axis, position - reach, position + reach).filter((near) => run.overlapLength(near) > 0);
  }

  /**
   * Moves a run to a new position on its axis (rounded like simplify() does): both
   * of its points move, so the neighbouring segments stretch accordingly.
   */
  move(run: Run, position: number): void {
    this.remove(run);
    const { route, index, axis } = run;
    const rounded = roundCoordinate(position);
    route[index] = { ...route[index]!, [axis]: rounded };
    route[index + 1] = { ...route[index + 1]!, [axis]: rounded };
    this.add(run);
  }

  private bucketOf(position: number): number {
    return Math.floor(position / this.bucketSize);
  }

  private key(run: Run): string {
    return `${run.axis}${this.bucketOf(run.position)}`;
  }

  private add(run: Run): void {
    const key = this.key(run);
    let bucket = this.buckets.get(key);
    if (!bucket) this.buckets.set(key, (bucket = new Set()));
    bucket.add(run);
  }

  private remove(run: Run): void {
    this.buckets.get(this.key(run))?.delete(run);
  }
}
