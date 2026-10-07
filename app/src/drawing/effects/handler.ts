import { reportImportError } from "../../attachments/service";
import { drawingEffects, type DrawingEffectMode } from "./effectSettings.svelte";
import {
  clampEffectBounds,
  effectBounds,
  effectRadiusAtLevel,
  effectSourcePadding,
  effectWorldRadius,
  type EffectPoint,
} from "./effectMath";
import { requireDrawingGpu, type DrawQuad, type GpuTexture } from "../gpu/glEngine";
import { pushDrawingHistory, rasterRectToWorld, selectionMaskTexture } from "../history";
import { drawingSelection } from "../selection.svelte";
import { drawingStore } from "../tileStore.svelte";
import { registerDrawTool } from "../toolRegistry";
import { DRAW_TILE_SIZE_PX, levelPxPerUnit, parseTileKey, type TileKey, type TileSnapshot, type WorldRect } from "../types";
import { drawingTools } from "../tools.svelte";
import type { DrawPointerEvent, DrawToolHandler } from "../types";
import type { SelectionClipMask } from "../selectionClip";

interface EffectGesture {
  mode: DrawingEffectMode;
  zoom: number;
  size: number;
  hardness: number;
  strength: number;
  direction: 1 | -1;
  selection: SelectionClipMask | null;
  last: EffectPoint;
  moved: boolean;
  released: boolean;
  cancelled: boolean;
  lastSwirlAt: number;
  /** Total swirl angle so far; every frame re-twists the untouched originals by this angle. */
  swirlTotal: number;
  /** Padded copies of the tiles under the swirl, taken at press. Twisting the already twisted
   *  tiles by a small step each frame rounded back to the same 8-bit pixels on small brushes and
   *  smooth (blurred) areas, so the swirl stalled. */
  swirlSources: Map<TileKey, { texture: GpuTexture; padding: number }>;
  frame: number | null;
  before: TileSnapshot;
  changed: Set<TileKey>;
  queue: Promise<void>;
  error: unknown;
}

function worldBounds(from: EffectPoint, to: EffectPoint, radius: number): WorldRect {
  const left = Math.min(from.x, to.x) - radius;
  const top = Math.min(from.y, to.y) - radius;
  const right = Math.max(from.x, to.x) + radius;
  const bottom = Math.max(from.y, to.y) + radius;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function snapshotNewTiles(gesture: EffectGesture, keys: readonly TileKey[]): Promise<void> {
  const missing = keys.filter((key) => !gesture.before.has(key));
  if (!missing.length) return Promise.resolve();
  return drawingStore.snapshot(missing).then((snapshot) => {
    for (const [key, value] of snapshot) gesture.before.set(key, value);
  });
}

function enqueue(gesture: EffectGesture, work: () => void | Promise<void>): void {
  gesture.queue = gesture.queue.then(async () => {
    if (gesture.cancelled) return;
    await work();
  }).catch((error: unknown) => {
    gesture.error ??= error;
  });
}

function selectionClipForTile(gpu: ReturnType<typeof requireDrawingGpu>, selection: SelectionClipMask | null, level: number, col: number, row: number) {
  if (!selection) return null;
  const toSelection = 2 ** (selection.level - level);
  return {
    texture: selectionMaskTexture(gpu, selection),
    width: selection.width,
    height: selection.height,
    rect: {
      x: col * DRAW_TILE_SIZE_PX * toSelection - selection.x,
      y: row * DRAW_TILE_SIZE_PX * toSelection - selection.y,
      width: DRAW_TILE_SIZE_PX * toSelection,
      height: DRAW_TILE_SIZE_PX * toSelection,
    },
  };
}

/** Copy a tile plus `padding` px of its neighbours (same level) into `target`. */
function fillEffectSource(
  gpu: ReturnType<typeof requireDrawingGpu>,
  target: GpuTexture,
  parsed: { level: number; col: number; row: number },
  padding: number,
): void {
  gpu.clear(target);
  const sourceSize = DRAW_TILE_SIZE_PX + padding * 2;
  const sourceX = parsed.col * DRAW_TILE_SIZE_PX - padding;
  const sourceY = parsed.row * DRAW_TILE_SIZE_PX - padding;
  const sourceWorld = rasterRectToWorld(sourceX, sourceY, sourceSize, sourceSize, parsed.level);
  const quads: DrawQuad[] = [];
  for (const sourceKey of drawingStore.keysInRect(sourceWorld, false, parsed.level)) {
    const sourceTile = drawingStore.texture(sourceKey, false);
    const sourceParsed = parseTileKey(sourceKey);
    if (!sourceTile || !sourceParsed) continue;
    quads.push({
      dst: {
        x: sourceParsed.col * DRAW_TILE_SIZE_PX - sourceX,
        y: sourceParsed.row * DRAW_TILE_SIZE_PX - sourceY,
        width: DRAW_TILE_SIZE_PX,
        height: DRAW_TILE_SIZE_PX,
      },
      src: {
        texture: sourceTile.tex,
        width: sourceTile.width,
        height: sourceTile.height,
        rect: { x: 0, y: 0, width: sourceTile.width, height: sourceTile.height },
      },
      mode: "rgba",
      color: [1, 1, 1, 1],
    });
  }
  gpu.drawInto(target, quads, "over");
}

/** Keep untouched copies of every tile the swirl can reach (the twist stays inside its circle). */
function captureSwirlSources(gesture: EffectGesture, keys: readonly TileKey[]): void {
  const gpu = requireDrawingGpu();
  for (const key of keys) {
    const parsed = parseTileKey(key);
    if (!parsed || gesture.swirlSources.has(key)) continue;
    const padding = Math.min(1024, Math.ceil(effectRadiusAtLevel(gesture.size, gesture.zoom, parsed.level)) + 2);
    const size = DRAW_TILE_SIZE_PX + padding * 2;
    const texture = gpu.createTexture(size, size, false);
    fillEffectSource(gpu, texture, parsed, padding);
    gesture.swirlSources.set(key, { texture, padding });
  }
}

function releaseSwirlSources(gesture: EffectGesture): void {
  if (!gesture.swirlSources.size) return;
  const gpu = requireDrawingGpu();
  for (const { texture } of gesture.swirlSources.values()) gpu.deleteTexture(texture);
  gesture.swirlSources.clear();
}

function applyEffectSegment(
  gesture: EffectGesture,
  mode: DrawingEffectMode,
  from: EffectPoint,
  to: EffectPoint,
  strength: number,
  swirlAngle = 0,
): void {
  if ((mode === "blur" || mode === "smudge") && strength <= 0) return;
  const gpu = requireDrawingGpu();
  const radiusWorld = effectWorldRadius(gesture.size, gesture.zoom);
  const touched = new Set<TileKey>();
  const keys = drawingStore.existingKeysInRect(worldBounds(from, to, radiusWorld));

  for (const key of keys) {
    if (gesture.cancelled) break;
    const parsed = parseTileKey(key);
    const target = drawingStore.texture(key, false);
    if (!parsed || !target) continue;

    const scale = levelPxPerUnit(parsed.level);
    const radius = effectRadiusAtLevel(gesture.size, gesture.zoom, parsed.level);
    const pointA = { x: from.x * scale - parsed.col * DRAW_TILE_SIZE_PX, y: from.y * scale - parsed.row * DRAW_TILE_SIZE_PX };
    const pointB = { x: to.x * scale - parsed.col * DRAW_TILE_SIZE_PX, y: to.y * scale - parsed.row * DRAW_TILE_SIZE_PX };
    const outputBounds = clampEffectBounds(effectBounds(pointA, pointB, radius), DRAW_TILE_SIZE_PX);
    if (!outputBounds) continue;

    const kept = mode === "swirl" ? gesture.swirlSources.get(key) : undefined;
    const padding = kept?.padding ?? effectSourcePadding(mode, radius, swirlAngle);
    let scratch = kept?.texture;
    if (!scratch) {
      const sourceSize = DRAW_TILE_SIZE_PX + padding * 2;
      scratch = gpu.scratchTexture(sourceSize, sourceSize);
      fillEffectSource(gpu, scratch, parsed, padding);
    }

    const core = Math.max(0, Math.min(radius * gesture.hardness, radius - 1));
    let drag: { x: number; y: number } | undefined;
    if (mode === "smudge") {
      const dx = pointB.x - pointA.x;
      const dy = pointB.y - pointA.y;
      const distance = Math.hypot(dx, dy);
      const amount = Math.min(distance, radius * 0.5);
      drag = distance > 0 ? { x: dx / distance * amount, y: dy / distance * amount } : { x: 0, y: 0 };
    }

    gpu.effectPass(target, scratch, {
      mode,
      rect: {
        x: outputBounds.left,
        y: outputBounds.top,
        width: outputBounds.right - outputBounds.left,
        height: outputBounds.bottom - outputBounds.top,
      },
      sourceRect: { x: padding, y: padding, width: DRAW_TILE_SIZE_PX, height: DRAW_TILE_SIZE_PX },
      path: { x: pointA.x, y: pointA.y, endX: pointB.x, endY: pointB.y },
      radius,
      core,
      strength,
      swirlAngle,
      drag,
      clip: selectionClipForTile(gpu, gesture.selection, parsed.level, parsed.col, parsed.row),
    });
    touched.add(key);
  }

  if (touched.size) {
    for (const key of touched) gesture.changed.add(key);
    drawingStore.commit([...touched]);
  }
}

/** Radians per second at strength 1, at the centre of the swirl. */
const SWIRL_SPEED = 2.4;

function startSwirlLoop(gesture: EffectGesture, isCurrent: () => boolean): void {
  const tick = (now: number) => {
    if (gesture.cancelled || gesture.released || !isCurrent()) return;
    const elapsed = Math.min(0.05, Math.max(0, (now - gesture.lastSwirlAt) / 1000));
    gesture.lastSwirlAt = now;
    if (elapsed > 0 && gesture.strength > 0) {
      gesture.swirlTotal += elapsed * SWIRL_SPEED * gesture.strength * gesture.direction;
      const angle = gesture.swirlTotal;
      enqueue(gesture, () => applyEffectSegment(gesture, "swirl", gesture.last, gesture.last, 1, angle));
    }
    gesture.frame = requestAnimationFrame(tick);
  };
  gesture.frame = requestAnimationFrame(tick);
}

export function createEffectHandler(): DrawToolHandler {
  let current: EffectGesture | null = null;
  let committing = false;

  function stopLoop(gesture: EffectGesture): void {
    if (gesture.frame !== null) cancelAnimationFrame(gesture.frame);
    gesture.frame = null;
  }

  async function settle(gesture: EffectGesture): Promise<void> {
    committing = true;
    await gesture.queue;
    releaseSwirlSources(gesture);
    if (gesture.error) {
      await drawingStore.restore(gesture.before);
      if (gesture.changed.size) drawingStore.commit([...gesture.changed]);
      reportImportError(gesture.error instanceof Error ? gesture.error.message : String(gesture.error));
    } else if (!gesture.cancelled && gesture.changed.size) {
      pushDrawingHistory(
        gesture.mode === "blur" ? "Blur drawing" : gesture.mode === "smudge" ? "Smudge drawing" : "Swirl drawing",
        gesture.before,
        [...gesture.changed],
      );
    } else if (gesture.cancelled && gesture.changed.size) {
      await drawingStore.restore(gesture.before);
      drawingStore.commit([...gesture.changed]);
    }
    committing = false;
  }

  function cancel(): void {
    const gesture = current;
    if (!gesture) return;
    current = null;
    gesture.cancelled = true;
    stopLoop(gesture);
    void settle(gesture).catch((error: unknown) => {
      reportImportError(error instanceof Error ? error.message : String(error));
      committing = false;
    });
  }

  return {
    down(event: DrawPointerEvent) {
      if (current || committing) return;
      const mode = drawingEffects.mode;
      const strength = mode === "blur" ? drawingEffects.blurStrength
        : mode === "smudge" ? drawingEffects.smudgeStrength : drawingEffects.swirlStrength;
      const now = performance.now();
      const gesture: EffectGesture = {
        mode,
        zoom: event.zoom,
        size: drawingTools.brush.size,
        hardness: drawingTools.brush.hardness,
        strength,
        direction: drawingEffects.swirlDirection === "cw" ? 1 : -1,
        selection: drawingSelection.area,
        last: { ...event.world },
        moved: false,
        released: false,
        cancelled: false,
        lastSwirlAt: now,
        swirlTotal: 0,
        swirlSources: new Map(),
        frame: null,
        before: new Map(),
        changed: new Set(),
        queue: Promise.resolve(),
        error: null,
      };
      current = gesture;

      if (mode === "swirl") {
        const radius = effectWorldRadius(gesture.size, gesture.zoom);
        const keys = drawingStore.existingKeysInRect(worldBounds(gesture.last, gesture.last, radius));
        enqueue(gesture, async () => {
          const before = await drawingStore.snapshot(keys);
          for (const [key, value] of before) gesture.before.set(key, value);
          captureSwirlSources(gesture, keys);
          if (!gesture.released && !gesture.cancelled && current === gesture) {
            startSwirlLoop(gesture, () => current === gesture);
          }
        });
      }
    },
    move(event: DrawPointerEvent) {
      const gesture = current;
      if (!gesture || gesture.mode === "swirl") return;
      const next = { ...event.world };
      const distance = Math.hypot(next.x - gesture.last.x, next.y - gesture.last.y);
      if (distance > 1e-4) {
        gesture.moved ||= distance > 1e-3;
        const from = gesture.last;
        gesture.last = next;
        enqueue(gesture, async () => {
          const radius = effectWorldRadius(gesture.size, gesture.zoom);
          const keys = drawingStore.existingKeysInRect(worldBounds(from, next, radius));
          await snapshotNewTiles(gesture, keys);
          if (!gesture.cancelled) applyEffectSegment(gesture, gesture.mode, from, next, gesture.strength);
        });
      }
    },
    up(event: DrawPointerEvent) {
      const gesture = current;
      if (!gesture) return;
      current = null;
      gesture.released = true;
      stopLoop(gesture);
      if (gesture.mode === "swirl") {
        const now = performance.now();
        enqueue(gesture, () => {
          const elapsed = Math.min(0.05, Math.max(0, (now - gesture.lastSwirlAt) / 1000));
          gesture.lastSwirlAt = now;
          if (elapsed > 0 && gesture.strength > 0) {
            gesture.swirlTotal += elapsed * SWIRL_SPEED * gesture.strength * gesture.direction;
            applyEffectSegment(gesture, "swirl", gesture.last, gesture.last, 1, gesture.swirlTotal);
          }
        });
      } else if (!gesture.moved && gesture.mode === "blur") {
        const point = { ...event.world };
        enqueue(gesture, async () => {
          const radius = effectWorldRadius(gesture.size, gesture.zoom);
          const keys = drawingStore.existingKeysInRect(worldBounds(point, point, radius));
          await snapshotNewTiles(gesture, keys);
          if (!gesture.cancelled) applyEffectSegment(gesture, "blur", point, point, gesture.strength);
        });
      } else if (gesture.mode === "blur" || gesture.mode === "smudge") {
        const end = { ...event.world };
        const distance = Math.hypot(end.x - gesture.last.x, end.y - gesture.last.y);
        if (distance > 1e-4) {
          const from = gesture.last;
          enqueue(gesture, async () => {
            const radius = effectWorldRadius(gesture.size, gesture.zoom);
            const keys = drawingStore.existingKeysInRect(worldBounds(from, end, radius));
            await snapshotNewTiles(gesture, keys);
            if (!gesture.cancelled) applyEffectSegment(gesture, gesture.mode, from, end, gesture.strength);
          });
        }
      }
      void settle(gesture).catch((error: unknown) => {
        reportImportError(error instanceof Error ? error.message : String(error));
        committing = false;
      });
    },
    cancel,
    deactivate: cancel,
  };
}

registerDrawTool("effect", createEffectHandler());
