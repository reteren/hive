import { snapToGrid } from "../board/gridMath";
import { worldToScreen, type Camera, type Point, type Size } from "../board/cameraMath";
import type { NoteKind } from "../model/note";

export type CreationTrigger = "keyboard" | "toolbar";

export interface CreationOrigin {
  world: Point;
  screen: Point;
}

export interface MenuSize {
  width: number;
  height: number;
}

export interface CreationObstacle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CreationNoteSize {
  type: NoteKind;
  width: number;
  height: number | null | undefined;
  text: string;
}

export interface PositionedCreationNote extends CreationNoteSize {
  x: number;
  y: number;
}

/** Keyboard creation follows the board cursor; toolbar creation uses the view centre. */
export function chooseCreationOrigin(
  trigger: CreationTrigger,
  cursorWorld: Point | null,
  camera: Camera,
  viewport: Size,
): CreationOrigin {
  if (trigger === "keyboard" && cursorWorld) {
    return {
      world: { ...cursorWorld },
      screen: worldToScreen(camera, viewport, cursorWorld),
    };
  }

  return {
    world: { x: camera.x, y: camera.y },
    screen: { x: viewport.width / 2, y: viewport.height / 2 },
  };
}

/** Centre a note on the chosen point, optionally snapping that centre to the grid. */
export function notePositionAt(
  center: Point,
  width: number,
  height: number,
  snap: boolean,
  step: number,
): Point {
  const placedCenter = snap ? snapToGrid(center, step) : center;
  return {
    x: placedCenter.x - width / 2,
    y: placedCenter.y - height / 2,
  };
}

/** Estimate an auto-height note before its first DOM measurement. */
export function estimatedCreationHeight(note: CreationNoteSize, measuredHeight?: number): number {
  if (note.height !== null && note.height !== undefined && Number.isFinite(note.height) && note.height > 0) {
    return note.height;
  }
  if (Number.isFinite(measuredHeight) && measuredHeight! > 0) return measuredHeight!;
  if (note.type === "beacon") return 7.2;
  if (note.type === "importance") return 4;
  if (note.type === "purpose" || note.type === "mood") return 4.2;

  const headerHeightPx = note.type === "pro" || note.type === "con" ? 24 : 28;
  const lines = estimateTextLines(note.text, note.width);
  const bodyHeightPx = Math.max(40, lines * 20.3 + 16);
  // Header + frame edges + content + outer border; matches the auto-height NoteNode chrome.
  return (headerHeightPx + 12 + bodyHeightPx + 2) / 10;
}

export function creationObstacleForNote(note: PositionedCreationNote, measuredHeight?: number): CreationObstacle {
  return {
    x: note.x,
    y: note.y,
    width: note.width,
    height: estimatedCreationHeight(note, measuredHeight),
  };
}

function estimateTextLines(text: string, width: number): number {
  if (!text) return 1;
  const charactersPerLine = Math.max(8, Math.floor((width * 10 - 30) / 8));
  return text.split(/\r?\n/).reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0);
}

/**
 * Return the nearest centre for a new rectangle that does not overlap existing bounds.
 * Touching edges are allowed. When snapping is enabled, every candidate centre stays on
 * the configured grid; the base point is snapped before collision checks as well.
 */
export function nearestFreeNoteCenter(
  center: Point,
  width: number,
  height: number,
  obstacles: readonly CreationObstacle[],
  snap: boolean,
  step: number,
): Point {
  if (![center.x, center.y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new RangeError("Creation position and size must be finite, with positive dimensions.");
  }
  if (snap && (!Number.isFinite(step) || step <= 0)) {
    throw new RangeError("Grid step must be a positive finite number when snapping is enabled.");
  }

  const base = snap ? snapToGrid(center, step) : { ...center };
  const validObstacles = obstacles.filter((obstacle) =>
    [obstacle.x, obstacle.y, obstacle.width, obstacle.height].every(Number.isFinite) &&
    obstacle.width > 0 && obstacle.height > 0,
  );
  if (!overlapsAny(base, width, height, validObstacles)) return base;

  const xCandidates = new Set<number>([base.x]);
  const yCandidates = new Set<number>([base.y]);
  for (const obstacle of validObstacles) {
    addBoundaryCandidates(xCandidates, obstacle.x - width / 2, snap, step);
    addBoundaryCandidates(xCandidates, obstacle.x + obstacle.width + width / 2, snap, step);
    addBoundaryCandidates(yCandidates, obstacle.y - height / 2, snap, step);
    addBoundaryCandidates(yCandidates, obstacle.y + obstacle.height + height / 2, snap, step);
  }

  const freeCandidates: Point[] = [];
  for (const x of xCandidates) {
    for (const y of yCandidates) {
      const candidate = { x, y };
      if (!overlapsAny(candidate, width, height, validObstacles)) freeCandidates.push(candidate);
    }
  }
  freeCandidates.sort((first, second) =>
    distanceSquared(base, first) - distanceSquared(base, second) ||
    first.y - second.y || first.x - second.x,
  );
  const nearest = freeCandidates[0];
  if (nearest) return nearest;

  // The finite set of obstacle boundaries always has an exterior point, but retain a
  // defensive failure rather than silently returning a position that overlaps.
  throw new Error("Could not find a free creation position.");
}

function addBoundaryCandidates(target: Set<number>, boundary: number, snap: boolean, step: number): void {
  if (!snap) {
    target.add(boundary);
    return;
  }
  target.add(Math.floor(boundary / step) * step);
  target.add(Math.ceil(boundary / step) * step);
}

function overlapsAny(center: Point, width: number, height: number, obstacles: readonly CreationObstacle[]): boolean {
  const edgeTolerance = 1e-9;
  const left = center.x - width / 2;
  const top = center.y - height / 2;
  const right = left + width;
  const bottom = top + height;
  return obstacles.some((obstacle) =>
    left < obstacle.x + obstacle.width - edgeTolerance && right > obstacle.x + edgeTolerance &&
    top < obstacle.y + obstacle.height - edgeTolerance && bottom > obstacle.y + edgeTolerance,
  );
}

function distanceSquared(first: Point, second: Point): number {
  const x = first.x - second.x;
  const y = first.y - second.y;
  return x * x + y * y;
}

/** Place the transient menu beside its anchor while keeping it within the viewport. */
export function createMenuPosition(anchor: Point, viewport: Size, menu: MenuSize): Point {
  const margin = 8;
  const gap = 10;
  const maxX = Math.max(margin, viewport.width - menu.width - margin);
  const maxY = Math.max(margin, viewport.height - menu.height - margin);
  const preferredX = anchor.x + gap + menu.width <= viewport.width - margin
    ? anchor.x + gap
    : anchor.x - gap - menu.width;
  const preferredY = anchor.y + gap + menu.height <= viewport.height - margin
    ? anchor.y + gap
    : anchor.y - gap - menu.height;

  return {
    x: Math.min(maxX, Math.max(margin, preferredX)),
    y: Math.min(maxY, Math.max(margin, preferredY)),
  };
}
