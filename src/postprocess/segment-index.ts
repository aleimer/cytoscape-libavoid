// Spatial index of segments, so neighbouring segments are found without comparing all pairs.

import type { Axis } from '../shared/geometry';
import type { Segment } from './segment';
import { roundCoordinate } from './simplify';

/**
 * Segments bucketed by axis and position, so the segments near a position are found
 * without comparing all pairs. Segments are only moved through the index, so it
 * never gets out of date.
 */
export class SegmentIndex
{
  /** The widest stroke: segments further apart than half of it plus half their own width cannot touch. */
  readonly maxWidth: number;
  /** Bucket width (px): wider than any stroke, so a search for overlaps looks at few buckets. */
  private readonly bucketSize: number;
  private readonly buckets = new Map<string, Set<Segment>>();

  constructor(segments: readonly Segment[])
  {
    this.maxWidth = segments.reduce((max, segment) => Math.max(max, segment.width), 0);
    this.bucketSize = this.maxWidth + 1;
    for (const segment of segments)
    {
      this.add(segment);
    }
  }

  /** Segments on `axis` positioned between `low` and `high`, and some up to a bucket outside: callers filter. */
  between(axis: Axis, low: number, high: number): Segment[]
  {
    const found: Segment[] = [];
    const last = this.bucketOf(high);
    for (let bucket = this.bucketOf(low); bucket <= last; bucket++)
    {
      for (const segment of this.buckets.get(`${axis}${bucket}`) ?? [])
      {
        found.push(segment);
      }
    }
    return found;
  }

  /** Segments that overlap the given one. */
  overlapping(segment: Segment): Segment[]
  {
    const reach = (segment.width + this.maxWidth) / 2;
    const { position } = segment;
    return this.between(segment.axis, position - reach, position + reach).filter(
      (near) => segment.overlapLength(near) > 0,
    );
  }

  /**
   * Moves a segment to a new position on its axis (rounded like simplify() does): both
   * of its points move, so the neighbouring segments stretch accordingly.
   */
  move(segment: Segment, position: number): void
  {
    this.remove(segment);
    const { route, index, axis } = segment;
    const rounded = roundCoordinate(position);
    route[index] = { ...route[index]!, [axis]: rounded };
    route[index + 1] = { ...route[index + 1]!, [axis]: rounded };
    this.add(segment);
  }

  private bucketOf(position: number): number
  {
    return Math.floor(position / this.bucketSize);
  }

  private key(segment: Segment): string
  {
    return `${segment.axis}${this.bucketOf(segment.position)}`;
  }

  private add(segment: Segment): void
  {
    const key = this.key(segment);
    let bucket = this.buckets.get(key);
    if (!bucket)
    {
      this.buckets.set(key, bucket = new Set());
    }
    bucket.add(segment);
  }

  private remove(segment: Segment): void
  {
    this.buckets.get(this.key(segment))?.delete(segment);
  }
}
