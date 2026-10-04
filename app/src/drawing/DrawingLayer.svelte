<script lang="ts">
  import { onMount } from "svelte";
  import { camera, viewport } from "../board/camera.svelte";
  import { PX_PER_UNIT } from "../board/cameraMath";
  import { drawingStrokePreview, previewStroke } from "./stroke.svelte";
  import { startDrawingPersistence } from "./persistence.svelte";
  import { drawingTileStore, tileWorldOrigin } from "./tileStore.svelte";
  import { drawingSelection } from "./selection.svelte";
  import { selectionMaskTexture } from "./history";
  import { drawingGpu, type DrawQuad } from "./gpu/glEngine";
  import { DRAW_TILE_SIZE_PX, levelPxPerUnit, levelTileUnits } from "./types";

  /*
   * The whole drawing is drawn by the GPU into one viewport canvas: one textured quad per visible tile
   * (mipmapped, so zoomed-out views stay cheap and smooth) plus the live stroke. It re-renders in the
   * same Svelte flush as the board transform — not on a later animation frame — so the drawing stays
   * locked to the grid while the camera moves.
   */
  let host = $state<HTMLDivElement | null>(null);
  const gpu = drawingGpu();

  function render(): void {
    if (!gpu || gpu.isLost || viewport.width <= 0 || viewport.height <= 0) return;
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = gpu.fitCanvas(viewport.width, viewport.height, ratio);
    // Device px per world unit, and the device px of world (0,0).
    const scale = camera.zoom * PX_PER_UNIT * ratio;
    const originX = (viewport.width / 2) * ratio - camera.x * scale;
    const originY = (viewport.height / 2) * ratio - camera.y * scale;
    const view = { x: -originX / scale, y: -originY / scale, width: width / scale, height: height / scale };
    const quads: DrawQuad[] = [];
    // Coarsest level first: finer detail is drawn on top.
    for (const level of drawingTileStore.levels()) {
      const margin = levelTileUnits(level) * 0.01;
      const keys = drawingTileStore.keysInRect({ x: view.x - margin, y: view.y - margin, width: view.width + margin * 2, height: view.height + margin * 2 }, false, level);
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
    const stroke = previewStroke();
    if (stroke) {
      const ppu = levelPxPerUnit(stroke.level);
      const opacity = drawingStrokePreview.opacity;
      const tint = drawingStrokePreview.erase ? [1, 1, 1] : stroke.color;
      const selection = drawingSelection.area;
      const clipTexture = selection ? selectionMaskTexture(gpu, selection) : null;
      for (const piece of stroke.pieces()) {
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
        quads.push({
          dst,
          src: { texture: piece.texture, width: piece.texWidth, height: piece.texHeight, rect: piece.texRect },
          mode: "mask",
          color: [tint[0]! * opacity, tint[1]! * opacity, tint[2]! * opacity, opacity],
          clip,
        });
      }
    }
    gpu.drawToScreen(quads);
  }

  $effect(() => {
    // Everything the picture depends on; rendering here keeps it in the board's own frame.
    void camera.x;
    void camera.y;
    void camera.zoom;
    void viewport.width;
    void viewport.height;
    void drawingTileStore.revision;
    void drawingStrokePreview.revision;
    void drawingSelection.area;
    render();
  });

  onMount(() => {
    if (gpu && host) host.prepend(gpu.canvas);
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
      stopRestored?.();
      window.removeEventListener("resize", onResolutionChange);
      gpu?.canvas.remove();
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
