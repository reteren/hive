<script lang="ts">
  import { onMount } from "svelte";
  import { camera, viewport } from "../board/camera.svelte";
  import { PX_PER_UNIT } from "../board/cameraMath";
  import { drawingStrokePreview, previewStroke } from "./stroke.svelte";
  import { startDrawingPersistence } from "./persistence.svelte";
  import { drawingTileStore, tileWorldOrigin } from "./tileStore.svelte";
  import { drawingSelection } from "./selection.svelte";
  import { selectionMaskTexture } from "./history";
  import { drawingGpu, type DrawQuad, type GpuTexture } from "./gpu/glEngine";
  import { DRAW_MAX_LEVEL, DRAW_MIN_LEVEL, DRAW_TILE_SIZE_PX, currentDrawLevel, levelPxPerUnit, levelTileUnits, parseTileKey, tileKey, type TileKey } from "./types";
  import { CoarseCompositeCache } from "./coarseCompositeCache.svelte";
  import { drawingLodPlan } from "./lod";

  /*
   * The whole drawing is drawn by the GPU into one viewport canvas: one textured quad per visible tile
   * (mipmapped, so zoomed-out views stay cheap and smooth) plus the live stroke. It re-renders in the
   * same Svelte flush as the board transform — not on a later animation frame — so the drawing stays
   * locked to the grid while the camera moves.
   */
  let host = $state<HTMLDivElement | null>(null);
  const gpu = drawingGpu();
  const compositeCache = gpu ? new CoarseCompositeCache(gpu, drawingTileStore) : null;

  /** Finished composites that can stand in for a tile still being built (see render). */
  function compositeStandIn(cache: CoarseCompositeCache, key: TileKey): [TileKey, GpuTexture][] {
    const own = cache.standIn(key);
    if (own) return [[key, own]];
    const tile = parseTileKey(key);
    if (!tile) return [];
    // Coarser parents first: one texture covers the whole tile.
    for (let up = 1; up <= 3 && tile.level + up <= DRAW_MAX_LEVEL; up += 1) {
      const factor = 2 ** up;
      const parentKey = tileKey(Math.floor(tile.col / factor), Math.floor(tile.row / factor), tile.level + up);
      const parent = cache.standIn(parentKey);
      if (parent) return [[parentKey, parent]];
    }
    // Then the four (or sixteen) finer children, when zooming out past a level.
    for (let down = 1; down <= 2 && tile.level - down >= DRAW_MIN_LEVEL; down += 1) {
      const factor = 2 ** down;
      const found: [TileKey, GpuTexture][] = [];
      for (let dy = 0; dy < factor; dy += 1) {
        for (let dx = 0; dx < factor; dx += 1) {
          const childKey = tileKey(tile.col * factor + dx, tile.row * factor + dy, tile.level - down);
          const child = cache.standIn(childKey);
          if (child) found.push([childKey, child]);
        }
      }
      if (found.length > 0) return found;
    }
    return [];
  }

  function render(): void {
    if (!gpu || gpu.isLost || viewport.width <= 0 || viewport.height <= 0) return;
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = gpu.fitCanvas(viewport.width, viewport.height, ratio);
    // Device px per world unit, and the device px of world (0,0).
    const scale = camera.zoom * PX_PER_UNIT * ratio;
    const originX = (viewport.width / 2) * ratio - camera.x * scale;
    const originY = (viewport.height / 2) * ratio - camera.y * scale;
    const view = { x: -originX / scale, y: -originY / scale, width: width / scale, height: height / scale };
    // Resolve only indexed tiles in the viewport; project open and pan load those lazily from disk.
    const desiredLevel = currentDrawLevel(camera.zoom);
    const margin = levelTileUnits(desiredLevel) * 0.02;
    const renderRect = { x: view.x - margin, y: view.y - margin, width: view.width + margin * 2, height: view.height + margin * 2 };
    // Coarsen the target if a very large viewport would need too many composite tiles. Finer levels
    // are folded into each target tile in idle batches instead of making the frame load them all.
    const plan = drawingLodPlan(renderRect, desiredLevel, drawingTileStore.levels());
    const visibleKeysByLevel = plan.fallbackLevels.map((level) => [level, drawingTileStore.keysInRect(renderRect, false, level)] as const);
    const visibleKeys = visibleKeysByLevel.flatMap(([, keys]) => keys);
    drawingTileStore.setVisibleKeys(visibleKeys);
    void drawingTileStore.ensureTiles(visibleKeys).catch((error: unknown) => console.error("Could not load visible drawing tiles", error));
    const quads: DrawQuad[] = [];
    // Native coarser levels are the immediate fallback while the target-level composites warm.
    for (const [, keys] of visibleKeysByLevel) {
      for (const key of keys) {
        const origin = tileWorldOrigin(key);
        const tile = drawingTileStore.texture(key, false);
        if (!origin || !tile) continue;
        gpu.ensureMips(tile);
        quads.push({
          dst: { x: originX + origin.x * scale, y: originY + origin.y * scale, width: origin.size * scale, height: origin.size * scale },
          src: { texture: tile.tex, width: DRAW_TILE_SIZE_PX, height: DRAW_TILE_SIZE_PX, rect: { x: 0, y: 0, width: DRAW_TILE_SIZE_PX, height: DRAW_TILE_SIZE_PX } },
          mode: "rgba",
          color: [1, 1, 1, 1],
        });
      }
    }
    const pushComposite = (key: TileKey, texture: WebGLTexture) => {
      const origin = tileWorldOrigin(key);
      if (!origin) return;
      quads.push({
        dst: { x: originX + origin.x * scale, y: originY + origin.y * scale, width: origin.size * scale, height: origin.size * scale },
        src: { texture, width: DRAW_TILE_SIZE_PX, height: DRAW_TILE_SIZE_PX, rect: { x: 0, y: 0, width: DRAW_TILE_SIZE_PX, height: DRAW_TILE_SIZE_PX } },
        mode: "rgba",
        color: [1, 1, 1, 1],
      });
    };
    // A target tile that is not built yet (the zoom just crossed a level, or the drawing changed) shows
    // the nearest finished composite instead of nothing: its own previous build, a coarser parent, or
    // finer children. Without this, drawings vanished for about a second on every zoom step.
    const drawnStandIns = new Set<TileKey>();
    for (const key of plan.compositeKeys) {
      if (!compositeCache) break;
      const complete = compositeCache.completeTexture(key);
      if (complete) {
        pushComposite(key, complete.tex);
        continue;
      }
      if (compositeCache.isEmpty(key)) continue;
      const standIn = compositeStandIn(compositeCache, key);
      if (standIn.length > 0) {
        for (const [standInKey, texture] of standIn) {
          if (drawnStandIns.has(standInKey)) continue;
          drawnStandIns.add(standInKey);
          pushComposite(standInKey, texture.tex);
        }
        continue;
      }
      const partial = compositeCache.texture(key);
      if (partial) pushComposite(key, partial.tex);
    }
    compositeCache?.request(plan.compositeKeys, plan.targetLevel);
    const strokeQuads: DrawQuad[] = [];
    const stroke = previewStroke();
    if (stroke) {
      const ppu = levelPxPerUnit(stroke.level);
      // Erasing is shown for real: the stroke cuts the drawing on screen (destination-out) while the
      // tiles change on release; painting shows the stroke in its colour and opacity.
      const erase = drawingStrokePreview.erase;
      const opacity = erase ? 1 : drawingStrokePreview.opacity;
      const tint = erase ? [1, 1, 1] : stroke.color;
      const selection = drawingSelection.area;
      const clipTexture = selection ? selectionMaskTexture(gpu, selection) : null;
      const strokeBounds = {
        x: view.x * ppu,
        y: view.y * ppu,
        width: view.width * ppu,
        height: view.height * ppu,
      };
      for (const piece of stroke.pieces(strokeBounds)) {
        const dst = {
          x: originX + (piece.x / ppu) * scale,
          y: originY + (piece.y / ppu) * scale,
          width: (piece.texRect.width / ppu) * scale,
          height: (piece.texRect.height / ppu) * scale,
        };
        if (dst.x > width || dst.y > height || dst.x + dst.width < 0 || dst.y + dst.height < 0) continue;
        let clip: DrawQuad["clip"] = null;
        if (selection && clipTexture) {
          const toSelection = 2 ** (stroke.level - selection.level);
          clip = {
            texture: clipTexture,
            width: selection.width,
            height: selection.height,
            rect: { x: piece.x * toSelection - selection.x, y: piece.y * toSelection - selection.y, width: piece.texRect.width * toSelection, height: piece.texRect.height * toSelection },
          };
        }
        strokeQuads.push({
          dst,
          src: { texture: piece.texture, width: piece.texWidth, height: piece.texHeight, rect: piece.texRect },
          mode: "mask",
          color: [tint[0]! * opacity, tint[1]! * opacity, tint[2]! * opacity, opacity],
          clip,
        });
      }
    }
    gpu.drawToScreen([
      { quads, blend: "over" },
      { quads: strokeQuads, blend: drawingStrokePreview.erase ? "out" : "over" },
    ]);
  }

  $effect(() => {
    // Everything the picture depends on; rendering here keeps it in the board's own frame.
    void camera.x;
    void camera.y;
    void camera.zoom;
    void viewport.width;
    void viewport.height;
    void drawingTileStore.revision;
    void drawingTileStore.contentRevision;
    void compositeCache?.revision;
    void drawingStrokePreview.revision;
    void drawingSelection.area;
    render();
  });

  onMount(() => {
    if (gpu && host) host.prepend(gpu.canvas);
    if (gpu) gpu.renderNow = render;
    const stopPersistence = startDrawingPersistence();
    const onResolutionChange = () => render();
    window.addEventListener("resize", onResolutionChange);
    const stopRestored = gpu?.onContextRestored(() => {
      // Every texture is gone with the old context: reload the window state from the saved project.
      console.warn("The drawing GPU context was restored; reloading the drawing.");
      window.location.reload();
    });
    return () => {
      stopPersistence();
      compositeCache?.dispose();
      stopRestored?.();
      window.removeEventListener("resize", onResolutionChange);
      gpu?.canvas.remove();
      if (gpu?.renderNow === render) gpu.renderNow = null;
    };
  });
</script>

<div class="drawing-layer" aria-hidden="true" data-drawing-layer bind:this={host}></div>

<style>
  .drawing-layer {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .drawing-layer :global(.drawing-surface) {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
</style>
