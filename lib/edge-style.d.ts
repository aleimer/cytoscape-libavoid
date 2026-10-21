import type { Point } from './libavoid.ts';
export interface EdgeSegmentStyle {
    'curve-style': 'segments' | 'round-segments';
    'edge-distances': 'endpoints';
    'source-endpoint': string;
    'target-endpoint': string;
    'segment-weights': string;
    'segment-distances': string;
    'segment-radii'?: number;
    'radius-type'?: 'arc-radius';
}
export declare const STYLE_PROPS: ReadonlyArray<keyof EdgeSegmentStyle>;
/**
 * @param points        route incl. both endpoints
 * @param srcPos        source node position (centre)
 * @param tgtPos        target node position (centre)
 * @param cornerRadius  0 = sharp taxi corners, > 0 = rounded corners
 * @returns style bypass object, or null if the route is degenerate
 */
export declare function routeToEdgeStyle(points: readonly Point[] | null | undefined, srcPos: Point, tgtPos: Point, cornerRadius?: number): EdgeSegmentStyle | null;
/** Inverse of routeToEdgeStyle (used by tests): reconstructs absolute points. */
export declare function edgeStyleToPoints(style: Pick<EdgeSegmentStyle, 'source-endpoint' | 'target-endpoint' | 'segment-weights' | 'segment-distances'>, srcPos: Point, tgtPos: Point): Point[];
//# sourceMappingURL=edge-style.d.ts.map