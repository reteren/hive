<script lang="ts">
  import { onMount } from "svelte";
  import { camera, viewport } from "../board/camera.svelte";
  import { PX_PER_UNIT } from "../board/cameraMath";
  import { drawingStrokePreview } from "./stroke.svelte";
  import { startDrawingPersistence } from "./persistence.svelte";
  import { drawingTileStore, tileWorldOrigin } from "./tileStore.svelte";
  import { levelTileUnits } from "./types";

  /*
   * The drawing is composited into ONE viewport-sized canvas in device pixels instead of one CSS-scaled
   * element per tile: CSS lays tiles out in board units before the camera scale, so the browser rounded
   * their positions/sizes there and a committed stroke visibly shifted, shrank and showed seams on the
   * tile grid. Here every tile edge is mapped to device px and rounded the same way for both neighbours.
   */
  let surface = $state<HTMLCanvasElement | null>(null);
  let previewSurface = $state<HTMLCanvasElement | null>(null);
  let tilesDirty = true;
  let previewDirty = true;
  let frame = 0;

  function schedule(): void {
    if (frame) return;
    frame = requestAnimationFrame(render);
  }

  $effect(() => {
    // Everything the tile picture depends on.
    void camera.x;
    void camera.y;
    void camera.zoom;
    void viewport.width;
    void viewport.height;
    void drawingTileStore.revision;
    tilesDirty = true;
    previewDirty = true;
    schedule();
  });

  $effect(() => {
    void drawingStrokePreview.revision;
    void drawingStrokePreview.source;
    previewDirty = true;
    schedule();
  });

  function deviceRatio(): number {
    return window.devicePixelRatio || 1;
  }

  /** Fit a canvas backing store to the viewport in device px; returns true when it was resized. */
  function fit(canvas: HTMLCanvasElement, ratio: number): boolean {
    const width = Math.max(1, Math.round(viewport.width * ratio));
    const height = Math.max(1, Math.round(viewport.height * ratio));
    if (canvas.width === width && canvas.height === height) return false;
    canvas.width = width;
    canvas.height = height;
    return true;
  }

  function render(): void {
    frame = 0;
    if (!surface || !previewSurface || viewport.width <= 0 || viewport.height <= 0) return;
    const ratio = deviceRatio();
    if (fit(surface, ratio)) tilesDirty = true;
    if (fit(previewSurface, ratio)) previewDirty = true;
    // Device px per world unit, and the device px of world (0,0).
    const scale = camera.zoom * PX_PER_UNIT * ratio;
    const originX = (viewport.width / 2) * ratio - camera.x * scale;
    const originY = (viewport.height / 2) * ratio - camera.y * scale;
    if (tilesDirty) {
      tilesDirty = false;
      drawTiles(surface, scale, originX, originY);
    }
    if (previewDirty) {
      previewDirty = false;
      drawPreview(previewSurface, scale, originX, originY);
    }
  }

  function drawTiles(canvas: HTMLCanvasElement, scale: number, originX: number, originY: number): void {
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    const view = {
      x: -originX / scale,
      y: -originY / scale,
      width: canvas.width / scale,
      height: canvas.height / scale,
    };
    // Coarsest level first: finer detail is drawn on top.
    for (const level of drawingTileStore.levels()) {
      const margin = levelTileUnits(level) * 0.01;
      const keys = drawingTileStore.keysInRect({
        x: view.x - margin,
        y: view.y - margin,
        width: view.width + margin * 2,
        height: view.height + margin * 2,
      }, false, level);
      for (const key of keys) {
        const origin = tileWorldOrigin(key);
        const tile = drawingTileStore.tile(key, false);
        if (!origin || !tile) continue;
        const left = Math.round(originX + origin.x * scale);
        const top = Math.round(originY + origin.y * scale);
        const right = Math.round(originX + (origin.x + origin.size) * scale);
        const bottom = Math.round(originY + (origin.y + origin.size) * scale);
        context.drawImage(tile, left, top, Math.max(1, right - left), Math.max(1, bottom - top));
      }
    }
  }

  function drawPreview(canvas: HTMLCanvasElement, scale: number, originX: number, originY: number): void {
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    const source = drawingStrokePreview.source;
    if (!source || source.width < 1 || source.height < 1) return;
    const ppu = drawingStrokePreview.pixelsPerUnit;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.globalAlpha = drawingStrokePreview.opacity;
    // Same mapping as the tiles it will be painted into (raster px → world → device px).
    context.drawImage(
      source,
      originX + (drawingStrokePreview.rasterX / ppu) * scale,
      originY + (drawingStrokePreview.rasterY / ppu) * scale,
      (source.width / ppu) * scale,
      (source.height / ppu) * scale,
    );
    context.globalAlpha = 1;
  }

  onMount(() => {
    const stopPersistence = startDrawingPersistence();
    const onResolutionChange = () => {
      tilesDirty = true;
      previewDirty = true;
      schedule();
    };
    window.addEventListener("resize", onResolutionChange);
    return () => {
      stopPersistence();
      window.removeEventListener("resize", onResolutionChange);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };
  });
</script>

<div class="drawing-layer" aria-hidden="true" data-drawing-layer>
  <canvas bind:this={surface} class="drawing-surface" data-drawing-surface></canvas>
  <canvas bind:this={previewSurface} class="drawing-surface" data-drawing-preview></canvas>
</div>

<style>
  .drawing-layer {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .drawing-surface {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
</style>
