import { snapToGrid } from "../board/gridMath";
import { worldToScreen, type Camera, type Point, type Size } from "../board/cameraMath";
import { BEACON_SIZE } from "../model/note";
import type { NoteKind } from "../model/note";
import { inboxHeightForEntryCount } from "../inbox/inboxLayout";

/** Keep newly created board objects visually distinct from their neighbours. */
export const CREATION_GAP = 2;

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

export const RANDOM_CREATION_GAP_MIN = 5;
export const RANDOM_CREATION_GAP_MAX = 15;

export interface RandomPlacementOptions {
  /** Optional deterministic source for tests. Values are clamped to 0..1. */
  rng?: () => number;
  /** Force a random placement beside this object, as Inbox entries do. */
  anchor?: CreationObstacle;
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
  if (note.type === "inbox") return inboxHeightForEntryCount(0);
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
 * Return a deterministic centre for a new rectangle with at least CREATION_GAP units
 * of clearance from existing objects. When snapping is enabled, the returned centre
 * remains on-grid and the outward-facing edge is rounded away from obstacles.
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
  // ME is a fixed beacon at the world origin, not a board note, so callers cannot
  // accidentally omit it from their note-derived obstacle list.
  validObstacles.push({
    x: -BEACON_SIZE / 2,
    y: -BEACON_SIZE / 2,
    width: BEACON_SIZE,
    height: BEACON_SIZE,
  });
  if (hasClearance(base, width, height, validObstacles)) return base;

  const hit = findHitObstacle(base, width, height, validObstacles);
  if (!hit) throw new Error("Could not find a creation obstacle.");

  const directions: Direction[] = ["right", "below", "left", "above"];
  for (const direction of directions) {
    let anchor = hit;
    // Each blocked slot advances to the furthest obstruction in that direction.
    // There are finitely many obstacles, so this finds an open slot without jitter.
    for (let attempt = 0; attempt <= validObstacles.length; attempt += 1) {
      const candidate = adjacentCenter(anchor, direction, width, height, snap, step);
      if (hasClearance(candidate, width, height, validObstacles)) return candidate;

      const blockers = collidingObstacles(candidate, width, height, validObstacles);
      const next = furthestBlocker(blockers, direction);
      if (!next || next === anchor) break;
      anchor = next;
    }
  }

  // Moving outward in any cardinal direction must eventually leave a finite set of
  // finite obstacles. Keep a defensive failure rather than placing an overlapping node.
  throw new Error("Could not find a free creation position.");
}

/**
 * Keep a free requested centre, but when it overlaps an object place it in a random
 * quadrant 5–15 units beyond that object's edges. Further collisions walk out from
 * the blocking object using another random edge gap. The optional anchor always uses
 * this behaviour, even when the requested centre itself is clear.
 */
export function randomFreeNoteCenter(
  center: Point,
  width: number,
  height: number,
  obstacles: readonly CreationObstacle[],
  snap: boolean,
  step: number,
  options: RandomPlacementOptions = {},
): Point {
  if (![center.x, center.y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new RangeError("Creation position and size must be finite, with positive dimensions.");
  }
  if (snap && (!Number.isFinite(step) || step <= 0)) {
    throw new RangeError("Grid step must be a positive finite number when snapping is enabled.");
  }

  const base = snap ? snapToGrid(center, step) : { ...center };
  const validObstacles = uniqueObstacles([
    ...obstacles,
    ...(options.anchor ? [options.anchor] : []),
    { x: -BEACON_SIZE / 2, y: -BEACON_SIZE / 2, width: BEACON_SIZE, height: BEACON_SIZE },
  ]);
  const baseHits = validObstacles.filter((obstacle) => rectanglesOverlap(base, width, height, obstacle));
  if (!options.anchor && baseHits.length === 0) return base;

  let anchor = options.anchor ?? baseHits[0];
  if (!anchor) return base;

  const rng = options.rng ?? Math.random;
  const signX = sampleRandom(rng) < 0.5 ? -1 : 1;
  const signY = sampleRandom(rng) < 0.5 ? -1 : 1;
  for (let attempt = 0; attempt <= validObstacles.length; attempt += 1) {
    const candidate = randomAdjacentCenter(anchor, width, height, signX, signY, rng);
    const blockers = validObstacles.filter((obstacle) => rectanglesOverlap(candidate, width, height, obstacle));
    if (blockers.length === 0) return candidate;
    anchor = furthestRandomBlocker(blockers, signX, signY);
  }

  // This defensive path is outside the union of every obstacle, so it cannot overlap.
  const bounds = obstacleUnion(validObstacles);
  return randomAdjacentCenter(bounds, width, height, signX, signY, rng);
}

function uniqueObstacles(obstacles: readonly CreationObstacle[]): CreationObstacle[] {
  const seen = new Set<string>();
  return obstacles.filter((obstacle) => {
    if (![obstacle.x, obstacle.y, obstacle.width, obstacle.height].every(Number.isFinite) ||
      obstacle.width <= 0 || obstacle.height <= 0) return false;
    const key = `${obstacle.x}:${obstacle.y}:${obstacle.width}:${obstacle.height}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function randomAdjacentCenter(
  obstacle: CreationObstacle,
  width: number,
  height: number,
  signX: -1 | 1,
  signY: -1 | 1,
  rng: () => number,
): Point {
  const gapX = randomGap(rng);
  const gapY = randomGap(rng);
  return {
    x: signX > 0
      ? obstacle.x + obstacle.width + width / 2 + gapX
      : obstacle.x - width / 2 - gapX,
    y: signY > 0
      ? obstacle.y + obstacle.height + height / 2 + gapY
      : obstacle.y - height / 2 - gapY,
  };
}

function randomGap(rng: () => number): number {
  return RANDOM_CREATION_GAP_MIN + sampleRandom(rng) * (RANDOM_CREATION_GAP_MAX - RANDOM_CREATION_GAP_MIN);
}

function sampleRandom(rng: () => number): number {
  const value = rng();
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
}

function furthestRandomBlocker(blockers: readonly CreationObstacle[], signX: -1 | 1, signY: -1 | 1): CreationObstacle {
  const outwardExtent = (obstacle: CreationObstacle): number =>
    (signX > 0 ? obstacle.x + obstacle.width : -obstacle.x) +
    (signY > 0 ? obstacle.y + obstacle.height : -obstacle.y);
  return [...blockers].sort((first, second) => outwardExtent(second) - outwardExtent(first))[0];
}

function obstacleUnion(obstacles: readonly CreationObstacle[]): CreationObstacle {
  const minX = Math.min(...obstacles.map((obstacle) => obstacle.x));
  const minY = Math.min(...obstacles.map((obstacle) => obstacle.y));
  const maxX = Math.max(...obstacles.map((obstacle) => obstacle.x + obstacle.width));
  const maxY = Math.max(...obstacles.map((obstacle) => obstacle.y + obstacle.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

type Direction = "right" | "below" | "left" | "above";

function adjacentCenter(
  obstacle: CreationObstacle,
  direction: Direction,
  width: number,
  height: number,
  snap: boolean,
  step: number,
): Point {
  let x: number;
  let y: number;
  switch (direction) {
    case "right":
      x = obstacle.x + obstacle.width + CREATION_GAP + width / 2;
      y = obstacle.y + height / 2;
      break;
    case "below":
      x = obstacle.x + width / 2;
      y = obstacle.y + obstacle.height + CREATION_GAP + height / 2;
      break;
    case "left":
      x = obstacle.x - CREATION_GAP - width / 2;
      y = obstacle.y + height / 2;
      break;
    case "above":
      x = obstacle.x + width / 2;
      y = obstacle.y - CREATION_GAP - height / 2;
      break;
  }
  if (!snap) return { x, y };

  return {
    x: direction === "right"
      ? Math.ceil(x / step) * step
      : direction === "left"
        ? Math.floor(x / step) * step
        : Math.round(x / step) * step,
    y: direction === "below"
      ? Math.ceil(y / step) * step
      : direction === "above"
        ? Math.floor(y / step) * step
        : Math.round(y / step) * step,
  };
}

function findHitObstacle(
  center: Point,
  width: number,
  height: number,
  obstacles: readonly CreationObstacle[],
): CreationObstacle | undefined {
  const directHits = obstacles.filter((obstacle) => rectanglesOverlap(center, width, height, obstacle));
  if (directHits.length > 0) return directHits[0];
  return collidingObstacles(center, width, height, obstacles)
    .sort((first, second) =>
      rectangleDistance(center, width, height, first) - rectangleDistance(center, width, height, second),
    )[0];
}

function hasClearance(
  center: Point,
  width: number,
  height: number,
  obstacles: readonly CreationObstacle[],
): boolean {
  return obstacles.every((obstacle) => rectangleDistance(center, width, height, obstacle) >= CREATION_GAP - 1e-9);
}

function collidingObstacles(
  center: Point,
  width: number,
  height: number,
  obstacles: readonly CreationObstacle[],
): CreationObstacle[] {
  return obstacles.filter((obstacle) => rectangleDistance(center, width, height, obstacle) < CREATION_GAP - 1e-9);
}

function rectangleDistance(center: Point, width: number, height: number, obstacle: CreationObstacle): number {
  const left = center.x - width / 2;
  const right = center.x + width / 2;
  const top = center.y - height / 2;
  const bottom = center.y + height / 2;
  const dx = Math.max(obstacle.x - right, left - obstacle.x - obstacle.width, 0);
  const dy = Math.max(obstacle.y - bottom, top - obstacle.y - obstacle.height, 0);
  return Math.hypot(dx, dy);
}

function rectanglesOverlap(center: Point, width: number, height: number, obstacle: CreationObstacle): boolean {
  const left = center.x - width / 2;
  const right = center.x + width / 2;
  const top = center.y - height / 2;
  const bottom = center.y + height / 2;
  return left < obstacle.x + obstacle.width && right > obstacle.x &&
    top < obstacle.y + obstacle.height && bottom > obstacle.y;
}

function furthestBlocker(blockers: readonly CreationObstacle[], direction: Direction): CreationObstacle | undefined {
  const key = (obstacle: CreationObstacle): number => {
    switch (direction) {
      case "right": return obstacle.x + obstacle.width;
      case "below": return obstacle.y + obstacle.height;
      case "left": return -obstacle.x;
      case "above": return -obstacle.y;
    }
  };
  return [...blockers].sort((first, second) => key(second) - key(first))[0];
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
