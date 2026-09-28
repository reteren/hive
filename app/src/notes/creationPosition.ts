import { snapToGrid } from "../board/gridMath";
import { worldToScreen, type Camera, type Point, type Size } from "../board/cameraMath";
import { BEACON_SIZE, normalizeNoteScale } from "../model/note";
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
  scale?: number;
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
  const scale = normalizeNoteScale(note.scale);
  return {
    x: note.x,
    y: note.y,
    width: note.width * scale,
    height: estimatedCreationHeight(note, measuredHeight) * scale,
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
 * Choose the closest free candidate among the eight sides around a fixed source.
 * Cardinal candidates use a 5–15 unit edge gap and a -15..15 unit tangent offset;
 * diagonal candidates use independent 5–15 unit gaps on both axes. When all eight
 * candidates are blocked, the same source is searched again in outward rings.
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

  const source = isValidObstacle(options.anchor)
    ? options.anchor
    : { x: center.x, y: center.y, width: 0, height: 0 };
  const sourceCenter = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
  const validObstacles = uniqueObstacles([
    ...obstacles,
    ...(isValidObstacle(options.anchor) ? [options.anchor] : []),
    { x: -BEACON_SIZE / 2, y: -BEACON_SIZE / 2, width: BEACON_SIZE, height: BEACON_SIZE },
  ]);
  const clearanceObstacles = isValidObstacle(options.anchor)
    ? validObstacles
    : [...validObstacles, source];

  const rng = options.rng ?? Math.random;
  const furthestObstacle = clearanceObstacles.reduce((extent, obstacle) => Math.max(
    extent,
    Math.abs(obstacle.x - sourceCenter.x),
    Math.abs(obstacle.x + obstacle.width - sourceCenter.x),
    Math.abs(obstacle.y - sourceCenter.y),
    Math.abs(obstacle.y + obstacle.height - sourceCenter.y),
  ), 0);
  const maxRing = Math.ceil((furthestObstacle + Math.max(width, height) + RANDOM_CREATION_GAP_MAX + 15 + (snap ? step : 0)) / 10);

  for (let ring = 0; ring <= maxRing; ring += 1) {
    const directions = shuffledDirections(rng);
    const candidates = directions.map((direction, order) => {
      const candidate = randomDirectionalCenter(source, sourceCenter, direction, width, height, ring, rng);
      return { center: snap ? snapToGrid(candidate, step) : candidate, order };
    }).filter(({ center: candidate }) => hasRandomClearance(
      candidate,
      width,
      height,
      clearanceObstacles,
    ));

    candidates.sort((first, second) => {
      const firstDistance = distanceSquared(first.center, sourceCenter);
      const secondDistance = distanceSquared(second.center, sourceCenter);
      return Math.abs(firstDistance - secondDistance) <= 1e-9
        ? first.order - second.order
        : firstDistance - secondDistance;
    });
    if (candidates[0]) return candidates[0].center;
  }

  throw new Error("Could not find a free random creation position.");
}

type RandomDirection = "right" | "below" | "left" | "above" | "right-below" | "right-above" | "left-below" | "left-above";

function isValidObstacle(obstacle: CreationObstacle | undefined): obstacle is CreationObstacle {
  return Boolean(obstacle && [obstacle.x, obstacle.y, obstacle.width, obstacle.height].every(Number.isFinite) &&
    obstacle.width > 0 && obstacle.height > 0);
}

function shuffledDirections(rng: () => number): RandomDirection[] {
  const directions: RandomDirection[] = [
    "right", "below", "left", "above",
    "right-below", "right-above", "left-below", "left-above",
  ];
  for (let index = directions.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.min(index, Math.floor(sampleRandom(rng) * (index + 1)));
    [directions[index], directions[swapIndex]] = [directions[swapIndex], directions[index]];
  }
  return directions;
}

function randomDirectionalCenter(
  source: CreationObstacle,
  sourceCenter: Point,
  direction: RandomDirection,
  width: number,
  height: number,
  ring: number,
  rng: () => number,
): Point {
  const left = source.x;
  const right = source.x + source.width;
  const top = source.y;
  const bottom = source.y + source.height;
  const ringOffset = ring * 10;
  let x: number;
  let y: number;

  switch (direction) {
    case "right":
      x = right + randomGap(rng, ringOffset) + width / 2;
      y = sourceCenter.y + randomTangentOffset(rng);
      break;
    case "left":
      x = left - randomGap(rng, ringOffset) - width / 2;
      y = sourceCenter.y + randomTangentOffset(rng);
      break;
    case "below":
      x = sourceCenter.x + randomTangentOffset(rng);
      y = bottom + randomGap(rng, ringOffset) + height / 2;
      break;
    case "above":
      x = sourceCenter.x + randomTangentOffset(rng);
      y = top - randomGap(rng, ringOffset) - height / 2;
      break;
    case "right-below":
      x = right + randomGap(rng, ringOffset) + width / 2;
      y = bottom + randomGap(rng, ringOffset) + height / 2;
      break;
    case "right-above":
      x = right + randomGap(rng, ringOffset) + width / 2;
      y = top - randomGap(rng, ringOffset) - height / 2;
      break;
    case "left-below":
      x = left - randomGap(rng, ringOffset) - width / 2;
      y = bottom + randomGap(rng, ringOffset) + height / 2;
      break;
    case "left-above":
      x = left - randomGap(rng, ringOffset) - width / 2;
      y = top - randomGap(rng, ringOffset) - height / 2;
      break;
  }

  return { x, y };
}

function randomGap(rng: () => number, ringOffset = 0): number {
  return RANDOM_CREATION_GAP_MIN + ringOffset +
    sampleRandom(rng) * (RANDOM_CREATION_GAP_MAX - RANDOM_CREATION_GAP_MIN);
}

function randomTangentOffset(rng: () => number): number {
  return (sampleRandom(rng) * 2 - 1) * RANDOM_CREATION_GAP_MAX;
}

function hasRandomClearance(
  candidate: Point,
  width: number,
  height: number,
  obstacles: readonly CreationObstacle[],
): boolean {
  return obstacles.every((obstacle) =>
    rectangleDistance(candidate, width, height, obstacle) >= RANDOM_CREATION_GAP_MIN - 1e-9,
  );
}

function distanceSquared(first: Point, second: Point): number {
  return (first.x - second.x) ** 2 + (first.y - second.y) ** 2;
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

function sampleRandom(rng: () => number): number {
  const value = rng();
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
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
