import { board, onBoardMutation } from "../model/board.svelte";
import { noteBounds } from "../notes/layout.svelte";
import { camera, viewport } from "./camera.svelte";
import { PX_PER_UNIT, type Point } from "./cameraMath";
import { GridIndex, type Rect } from "./spatialIndex";

/**
 * What the board has to draw right now, game-engine style: a spatial index over every note, the set of
 * notes near the viewport (plus pinned ones), and a level of detail chosen from the zoom.
 * Everything here is O(changed notes) or O(visible notes); nothing walks the whole board per frame.
 */

export type LodTier = "full" | "simple" | "min";

/**
 * Zoom thresholds with hysteresis, so hovering around a boundary does not remount everything.
 * FULL_* is also the per-note text threshold, applied to zoom × the note's own scale (noteShowsFull):
 * a big note keeps its text much farther out than a small one.
 */
const FULL_ENTER = 0.2;
const FULL_LEAVE = 0.17;
const SIMPLE_ENTER = 0.13;
const SIMPLE_LEAVE = 0.11;
/** Viewport margin (fraction of the viewport) a note must enter to mount, and leave to unmount. */
const MOUNT_MARGIN = 0.35;
const UNMOUNT_MARGIN = 0.9;
/** Grid cell in board units: a few typical notes per cell. */
const CELL = 64;
/** Idle safety pass: re-index notes whose geometry changed without a mutation event. */
const RECONCILE_BATCH = 1500;
const RECONCILE_INTERVAL_MS = 1000;

export const lod: { tier: LodTier } = $state({ tier: "full" });
/**
 * `ids` is replaced (never mutated) when membership changes; Svelte does not proxy the Set.
 * `rect` is a world rectangle that always contains the screen; it changes only occasionally.
 */
export const visible: { ids: ReadonlySet<string>; rect: Rect } = $state({
  ids: new Set<string>(),
  rect: { x: 0, y: 0, width: 0, height: 0 },
});

/** Pinned notes (playing media, recording, a shell being opened): always mounted with their full body. */
export const pinned: { ids: ReadonlySet<string> } = $state({ ids: new Set<string>() });

const index = new GridIndex(CELL);
const dirty = new Set<string>();
let everythingDirty = true;
const pins = new Map<string, Map<symbol, string>>();
let frame: number | null = null;
let started = false;

/** Notes (any, not only visible) whose bounds intersect `rect`. Unordered. */
export function queryRect(rect: Rect): string[] {
  flushIndex();
  return index.query(rect);
}

/** Notes whose bounds contain `point`. Unordered. */
export function queryPoint(point: Point): string[] {
  flushIndex();
  return index.queryPoint(point);
}

/** Keep a note mounted even when it is off-screen (playing media, recording, active gesture). */
export function pinNote(id: string, reason: string): () => void {
  const token = Symbol(reason);
  let reasons = pins.get(id);
  if (!reasons) {
    reasons = new Map();
    pins.set(id, reasons);
  }
  reasons.set(token, reason);
  membershipDirty = true;
  publishPins();
  scheduleVisibility();
  return () => {
    const current = pins.get(id);
    if (!current?.delete(token)) return;
    if (current.size === 0) pins.delete(id);
    membershipDirty = true;
    publishPins();
    scheduleVisibility();
  };
}

function publishPins(): void {
  const ids = new Set(pins.keys());
  if (ids.size !== pinned.ids.size || [...ids].some((id) => !pinned.ids.has(id))) pinned.ids = ids;
}

/** Geometry of these notes changed outside board helpers (e.g. a measured height). */
export function markNotesDirty(ids: Iterable<string>): void {
  for (const id of ids) dirty.add(id);
  scheduleVisibility();
}

export function tierForZoom(zoom: number, current: LodTier): LodTier {
  if (current === "full") return zoom < FULL_LEAVE ? (zoom < SIMPLE_LEAVE ? "min" : "simple") : "full";
  if (current === "simple") return zoom >= FULL_ENTER ? "full" : zoom < SIMPLE_LEAVE ? "min" : "simple";
  return zoom >= FULL_ENTER ? "full" : zoom >= SIMPLE_ENTER ? "simple" : "min";
}

/** Whether a note draws its full body (text) at this zoom; `wasFull` adds hysteresis per note. */
export function noteShowsFull(zoom: number, noteScale: number, wasFull: boolean): boolean {
  return zoom * noteScale >= (wasFull ? FULL_LEAVE : FULL_ENTER);
}

/** World rectangle on screen, grown by `margin` viewports on every side. */
export function viewportWorldRect(margin = 0): Rect {
  const unitsPerPx = 1 / (camera.zoom * PX_PER_UNIT);
  const width = viewport.width * unitsPerPx;
  const height = viewport.height * unitsPerPx;
  return {
    x: camera.x - width / 2 - width * margin,
    y: camera.y - height / 2 - height * margin,
    width: width * (1 + 2 * margin),
    height: height * (1 + 2 * margin),
  };
}

/** Start following the board and the camera. Idempotent; lives for the whole app. */
export function startVisibility(): void {
  if (started) return;
  started = true;
  onBoardMutation((ids) => {
    if (ids === null) everythingDirty = true;
    else for (const id of ids) dirty.add(id);
    scheduleVisibility();
  });
  $effect.root(() => {
    $effect(() => {
      // Camera and viewport are the only reactive inputs; geometry arrives through mutations.
      void camera.x;
      void camera.y;
      void camera.zoom;
      void viewport.width;
      void viewport.height;
      scheduleVisibility();
    });
  });
  window.setInterval(reconcileSlice, RECONCILE_INTERVAL_MS);
}

function scheduleVisibility(): void {
  if (frame !== null || typeof requestAnimationFrame === "undefined") return;
  frame = requestAnimationFrame(() => {
    frame = null;
    updateVisibility();
  });
}

/** Bring the index up to date with every recorded change. */
function flushIndex(): void {
  if (everythingDirty) {
    everythingDirty = false;
    dirty.clear();
    index.clear();
    for (const id of board.order) indexNote(id);
    return;
  }
  if (dirty.size === 0) return;
  for (const id of dirty) indexNote(id);
  dirty.clear();
}

function indexNote(id: string): void {
  const note = board.notes[id];
  if (!note) {
    index.delete(id);
    return;
  }
  index.set(id, noteBounds(note));
}

/** Camera state of the last membership pass; small pans inside the mount margin skip the query. */
let lastPass: { x: number; y: number; zoom: number; width: number; height: number } | null = null;
let membershipDirty = true;

export function updateVisibility(): void {
  const hadChanges = everythingDirty || dirty.size > 0;
  flushIndex();
  const zoom = camera.zoom;
  const tier = tierForZoom(zoom, lod.tier);
  if (tier !== lod.tier) lod.tier = tier;
  if (viewport.width <= 0 || viewport.height <= 0) return;
  const stepX = viewport.width / (zoom * PX_PER_UNIT) * 0.15;
  const stepY = viewport.height / (zoom * PX_PER_UNIT) * 0.15;
  if (!hadChanges && !membershipDirty && lastPass &&
    Math.abs(camera.x - lastPass.x) < stepX && Math.abs(camera.y - lastPass.y) < stepY &&
    Math.abs(Math.log(zoom / lastPass.zoom)) < 0.05 && viewport.width === lastPass.width && viewport.height === lastPass.height) {
    return;
  }
  lastPass = { x: camera.x, y: camera.y, zoom, width: viewport.width, height: viewport.height };
  membershipDirty = false;

  const inner = viewportWorldRect(MOUNT_MARGIN);
  const outer = viewportWorldRect(UNMOUNT_MARGIN);
  const next = new Set(index.query(inner));
  // Hysteresis: a mounted note stays until it leaves the wider rectangle.
  const previous = visible.ids;
  if (previous.size > 0) {
    for (const id of previous) {
      if (next.has(id)) continue;
      const rect = index.rectOf(id);
      if (rect && intersectsRect(rect, outer)) next.add(id);
    }
  }
  for (const id of pins.keys()) if (board.notes[id]) next.add(id);

  if (!sameSet(previous, next)) visible.ids = next;
  // Publish a generous rectangle and replace it only when the screen leaves it or the zoom changed a
  // lot, so consumers (link culling…) recompute a few times per pan, not every frame.
  const screen = viewportWorldRect(0);
  const published = visible.rect;
  const scaleChanged = published.width > 0 && Math.abs(Math.log(published.width / outer.width)) > Math.log(1.25);
  if (published.width === 0 || scaleChanged || !containsRect(published, screen)) visible.rect = outer;
}

/** Slowly re-check every note's bounds so a change that bypassed the mutation hooks heals itself. */
let reconcileCursor = 0;
function reconcileSlice(): void {
  const order = board.order;
  if (order.length === 0) return;
  const end = Math.min(order.length, reconcileCursor + RECONCILE_BATCH);
  let changed = false;
  for (let i = reconcileCursor; i < end; i += 1) {
    const id = order[i];
    const note = board.notes[id];
    if (!note) continue;
    const bounds = noteBounds(note);
    const rect = index.rectOf(id);
    if (!rect || rect.x !== bounds.x || rect.y !== bounds.y || rect.width !== bounds.width || rect.height !== bounds.height) {
      dirty.add(id);
      changed = true;
    }
  }
  reconcileCursor = end >= order.length ? 0 : end;
  if (changed) scheduleVisibility();
}

function intersectsRect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

function containsRect(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}
