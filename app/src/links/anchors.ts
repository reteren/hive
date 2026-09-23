import type { Point } from "../board/cameraMath";
import type { LinkAnchor } from "../model/link";
import type { Bounds } from "../notes/layout.svelte";

export interface ShapeEndpoints {
  start: Point;
  end: Point;
  startNormal: Point;
  endNormal: Point;
}

/** Project a point inside a note onto its nearest frame edge. */
export function projectPointToAnchor(bounds: Bounds, point: Point): LinkAnchor {
  const x = clamp(point.x, bounds.x, bounds.x + bounds.width);
  const y = clamp(point.y, bounds.y, bounds.y + bounds.height);
  const distances = [
    { edge: "top", distance: Math.abs(y - bounds.y) },
    { edge: "right", distance: Math.abs(bounds.x + bounds.width - x) },
    { edge: "bottom", distance: Math.abs(bounds.y + bounds.height - y) },
    { edge: "left", distance: Math.abs(x - bounds.x) },
  ] as const;
  const edge = distances.reduce((best, candidate) => candidate.distance < best.distance ? candidate : best).edge;
  const nx = clamp01((x - bounds.x) / bounds.width);
  const ny = clamp01((y - bounds.y) / bounds.height);

  switch (edge) {
    case "top": return { x: nx, y: 0 };
    case "right": return { x: 1, y: ny };
    case "bottom": return { x: nx, y: 1 };
    case "left": return { x: 0, y: ny };
  }
}

/** Resolve a normalised attachment against the object's current bounds. */
export function pointAtAnchor(bounds: Bounds, anchor: LinkAnchor): Point {
  const edgeAnchor = frameAnchor(anchor);
  return {
    x: bounds.x + edgeAnchor.x * bounds.width,
    y: bounds.y + edgeAnchor.y * bounds.height,
  };
}

export function isFrameAnchor(value: unknown): value is LinkAnchor {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<LinkAnchor>;
  return typeof candidate.x === "number" && Number.isFinite(candidate.x) && candidate.x >= 0 && candidate.x <= 1 &&
    typeof candidate.y === "number" && Number.isFinite(candidate.y) && candidate.y >= 0 && candidate.y <= 1 &&
    (candidate.x === 0 || candidate.x === 1 || candidate.y === 0 || candidate.y === 1);
}

/** Outward normal for a frame attachment. */
export function normalAtAnchor(anchor: LinkAnchor): Point {
  const edgeAnchor = frameAnchor(anchor);
  if (edgeAnchor.x === 0) return { x: -1, y: 0 };
  if (edgeAnchor.x === 1) return { x: 1, y: 0 };
  if (edgeAnchor.y === 0) return { x: 0, y: -1 };
  return { x: 0, y: 1 };
}

/** Build the endpoint geometry for a shape, preserving explicit note anchors. */
export function shapeEndpoints(
  source: Bounds,
  target: Bounds,
  sourceAnchor?: LinkAnchor,
  targetAnchor?: LinkAnchor,
  sourceIsCenter = false,
  targetIsCenter = false,
): ShapeEndpoints {
  const sourceCenter = center(source);
  const targetCenter = center(target);
  const fixedStart = sourceAnchor ? pointAtAnchor(source, sourceAnchor) : sourceIsCenter ? sourceCenter : undefined;
  const fixedEnd = targetAnchor ? pointAtAnchor(target, targetAnchor) : targetIsCenter ? targetCenter : undefined;
  const start = fixedStart ?? framePointToward(source, fixedEnd ?? targetCenter);
  const end = fixedEnd ?? framePointToward(target, fixedStart ?? start);

  return {
    start,
    end,
    startNormal: sourceAnchor ? normalAtAnchor(sourceAnchor) : sourceIsCenter ? { x: 0, y: 0 } : frameNormal(source, start),
    endNormal: targetAnchor ? normalAtAnchor(targetAnchor) : targetIsCenter ? { x: 0, y: 0 } : frameNormal(target, end),
  };
}

function framePointToward(bounds: Bounds, toward: Point): Point {
  const origin = center(bounds);
  let dx = toward.x - origin.x;
  let dy = toward.y - origin.y;
  if (dx === 0 && dy === 0) dx = 1;
  const horizontal = dx === 0 ? Number.POSITIVE_INFINITY : bounds.width / 2 / Math.abs(dx);
  const vertical = dy === 0 ? Number.POSITIVE_INFINITY : bounds.height / 2 / Math.abs(dy);
  const scale = Math.min(horizontal, vertical);
  const point = { x: origin.x + dx * scale, y: origin.y + dy * scale };
  return point;
}

function frameNormal(bounds: Bounds, point: Point): Point {
  const distances = [
    { edge: "left", distance: Math.abs(point.x - bounds.x) },
    { edge: "right", distance: Math.abs(point.x - (bounds.x + bounds.width)) },
    { edge: "top", distance: Math.abs(point.y - bounds.y) },
    { edge: "bottom", distance: Math.abs(point.y - (bounds.y + bounds.height)) },
  ] as const;
  const edge = distances.reduce((best, candidate) => candidate.distance < best.distance ? candidate : best).edge;
  switch (edge) {
    case "left": return { x: -1, y: 0 };
    case "right": return { x: 1, y: 0 };
    case "top": return { x: 0, y: -1 };
    case "bottom": return { x: 0, y: 1 };
  }
}

function center(bounds: Bounds): Point {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0.5;
}

function frameAnchor(anchor: LinkAnchor): LinkAnchor {
  const x = clamp01(anchor.x);
  const y = clamp01(anchor.y);
  if (x === 0 || x === 1 || y === 0 || y === 1) return { x, y };

  const edges = [
    { edge: "top", distance: y },
    { edge: "right", distance: 1 - x },
    { edge: "bottom", distance: 1 - y },
    { edge: "left", distance: x },
  ] as const;
  switch (edges.reduce((best, candidate) => candidate.distance < best.distance ? candidate : best).edge) {
    case "top": return { x, y: 0 };
    case "right": return { x: 1, y };
    case "bottom": return { x, y: 1 };
    case "left": return { x: 0, y };
  }
}
