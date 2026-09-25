import type { Point } from "../board/cameraMath";
import type { ZoneShape } from "./shape";

/**
 * R4.6–R4.7 contract: the editable form of a zone while "Edit shape" is active. Unlike a
 * normalized ZoneShape it may contain extra collinear cut points (M014: they stay until the
 * user leaves and re-enters edit mode). Implemented by the contour-edit worker; the editor UI
 * worker calls these pure functions.
 */
export interface ContourRing {
  kind: "part" | "hole";
  points: Point[];
}

export interface EditContour {
  rings: ContourRing[];
}

/** An edge is identified by its ring and the index of its first point (edge i = points[i] → points[i+1]). */
export interface EdgeRef {
  ring: number;
  edge: number;
}

export interface VertexRef {
  ring: number;
  vertex: number;
}

export interface EdgeHit extends EdgeRef {
  /** Closest point on the edge (snapped to the grid when `snapStep` is given). */
  point: Point;
  distance: number;
}

export interface ContourEditOptions {
  /** Minimum thickness of any piece (MIN_ZONE_PART). */
  minPart: number;
  /** Other zones: an edit stops at their boundary and never creates an area overlap (M019/M020). */
  obstacles: readonly ZoneShape[];
  /** Grid step when snapping is on. */
  snapStep?: number;
}

/** Shape → editable contour. `cleanup` removes collinear points (on (re)entering edit mode, M014). */
export declare function shapeToContour(shape: ZoneShape, cleanup: boolean): EditContour;
/** Editable contour → normalized shape for storing in the zone. */
export declare function contourToShape(contour: EditContour): ZoneShape;

/** Hover: nearest edge within `tolerance` (u) of `point`, for the cut marker (M011). */
export declare function hitEdge(contour: EditContour, point: Point, tolerance: number, snapStep?: number): EdgeHit | null;
/** Hover/drag target: nearest vertex within `tolerance`. */
export declare function hitVertex(contour: EditContour, point: Point, tolerance: number): VertexRef | null;

/** Click on an edge: splits it at `point` (a cut, M011). No-op when the point is an existing vertex. */
export declare function insertCut(contour: EditContour, edge: EdgeRef, point: Point): EditContour;

/**
 * Drags one segment by `delta` (H21, agreed 25.09):
 * - perpendicular movement shifts the segment and adds the connecting edges → a step (inwards)
 *   or a protrusion (outwards);
 * - movement along a segment whose one end is a cut point: dragging away from the cut grows the
 *   zone on that side (the far end and its adjacent edge move with it); dragging towards the cut
 *   moves the cut point and shortens the neighbouring segment down to the minimum.
 * The result is clamped so no piece gets thinner than `minPart`, the ring never self-intersects,
 * and no obstacle is overlapped (the edge stops at the obstacle, M019).
 */
export declare function dragSegment(contour: EditContour, edge: EdgeRef, delta: Point, options: ContourEditOptions): EditContour;

/** Drags a corner: only the two edges at that corner move (M013). */
export declare function dragVertex(contour: EditContour, vertex: VertexRef, delta: Point, options: ContourEditOptions): EditContour;

/** Ctrl-drag of a corner: the whole zone scales, anchored at the opposite bounds corner (M013). */
export declare function scaleByVertex(contour: EditContour, vertex: VertexRef, delta: Point, options: ContourEditOptions): EditContour;
