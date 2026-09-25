import type { Point } from "../board/cameraMath";
import type { ZoneBounds } from "../model/zone";

/**
 * R4.6–R4.8 contract: geometry of a zone shape (orthogonal polygons only — every edge is
 * horizontal or vertical). A shape is one or more outer parts plus holes; it keeps the zone's
 * identity (one zone, several parts, M017). All values are in u. Implemented by the shape-engine
 * worker; other workers code against these signatures only.
 */
export interface ZoneShape {
  /** Outer contours, clockwise in screen space (y down). Parts never overlap by area. */
  parts: Point[][];
  /** Holes, counter-clockwise, each inside exactly one part. */
  holes: Point[][];
}

/** No part, protrusion or remaining strip of a zone may be thinner than this (user decision 25.09: 30 u). */
export const MIN_ZONE_PART = 30;

/** Canonical form: removes duplicate and collinear points, fixes orientation, merges touching cells. */
export declare function normalizeShape(shape: ZoneShape): ZoneShape;

export declare function shapeArea(shape: ZoneShape): number;
export declare function shapeBounds(shape: ZoneShape): ZoneBounds;
/** Inside a part and not inside a hole; points exactly on an edge count as inside. */
export declare function shapeContainsPoint(shape: ZoneShape, point: Point): boolean;
/** Area of the shape that lies inside the rectangle (membership and marquee use it). */
export declare function shapeAreaInRect(shape: ZoneShape, rect: ZoneBounds): number;
/** True when the two shapes share a positive area (touching edges is allowed, M020). */
export declare function shapesOverlap(a: ZoneShape, b: ZoneShape): boolean;

/**
 * Removes the rectangle from the shape (R4.8 cut-out). Holes and several parts are allowed; any
 * strip thinner than `minPart` that remains is dropped (M018). Returns null when nothing is left.
 */
export declare function subtractRect(shape: ZoneShape, rect: ZoneBounds, minPart?: number): ZoneShape | null;
/** Drops every piece of the shape thinner than `minPart` in either direction. */
export declare function pruneThin(shape: ZoneShape, minPart?: number): ZoneShape | null;
/** True when some piece is thinner than `minPart` (edit gestures clamp before this happens). */
export declare function hasThinPiece(shape: ZoneShape, minPart?: number): boolean;

export declare function translateShape(shape: ZoneShape, delta: Point): ZoneShape;
/** Scales around `anchor` (Ctrl-drag of a corner scales the whole zone, M013). */
export declare function scaleShape(shape: ZoneShape, anchor: Point, scaleX: number, scaleY: number): ZoneShape;
