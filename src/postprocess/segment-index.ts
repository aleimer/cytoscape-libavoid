/** Spatial index of segments, so neighbouring segments are found without comparing all pairs. */

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
  readonly widestStroke: number;
  /** Bucket width (px): wider than any stroke, so a search for overlaps looks at few buckets. */
  private readonly bucketSize: number;
  /** Bucket key (axis and bucket number, see {@link SegmentIndex.key}) -> the segments in it. */
  private readonly buckets = new Map<string, Set<Segment>>();

  /** @param segments all segments to index; they are moved through {@link SegmentIndex.move} only */
  constructor(segments: readonly Segment[])
  {
    this.widestStroke = segments.reduce((max, segment) => Math.max(max, segment.width), 0);
    this.bucketSize = this.widestStroke + 1;
    for (const segment of segments)
    {
      this.add(segment);
    }
  }

  /**
   * Segments on an axis positioned between two coordinates. Whole buckets are
   * returned, so some lie up to a bucket outside: callers check exactly.
   *
   * @param axis the {@link Segment.positionAxis} of the segments to find
   * @param low  the lowest position
   * @param high the highest position
   * @returns the segments, in no particular order
   */
  segmentsBetween(axis: Axis, low: number, high: number): Segment[]
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

  /**
   * Segments of other edges whose strokes overlap a segment, see {@link Segment.overlapLength}.
   *
   * @param segment the segment to compare with
   * @returns the overlapping segments, without `segment` itself
   */
  overlapping(segment: Segment): Segment[]
  {
    const reach = (segment.width + this.widestStroke) / 2;
    const { position } = segment;
    return this.segmentsBetween(segment.positionAxis, position - reach, position + reach).filter(
      (near) => segment.overlapLength(near) > 0,
    );
  }

  /**
   * Moves a segment to a new position on its axis, rounded with {@link roundCoordinate}.
   * Both of its points move, so the neighbouring segments stretch accordingly.
   *
   * @param segment  an indexed segment
   * @param position the new position on {@link Segment.positionAxis}
   */
  move(segment: Segment, position: number): void
  {
    this.remove(segment);
    const { route, startIndex, positionAxis } = segment;
    const rounded = roundCoordinate(position);
    route[startIndex] = { ...route[startIndex]!, [positionAxis]: rounded };
    route[startIndex + 1] = { ...route[startIndex + 1]!, [positionAxis]: rounded };
    this.add(segment);
  }

  /**
   * @param position a position on any axis
   * @returns the number of the bucket it falls into
   */
  private bucketOf(position: number): number
  {
    return Math.floor(position / this.bucketSize);
  }

  /**
   * @param segment an indexed segment
   * @returns the key of the bucket it is in now, e.g. `x12`
   */
  private key(segment: Segment): string
  {
    return `${segment.positionAxis}${this.bucketOf(segment.position)}`;
  }

  /** @param segment put into the bucket of its current position */
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

  /** @param segment taken out of the bucket of its current position, before it moves */
  private remove(segment: Segment): void
  {
    this.buckets.get(this.key(segment))?.delete(segment);
  }
}
