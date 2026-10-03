<script lang="ts">
  import { onMount } from "svelte";
  import type { Action } from "svelte/action";
  import { camera, viewport } from "../board/camera.svelte";
  import { PX_PER_UNIT, screenToWorld } from "../board/cameraMath";
  import { drawingStrokePreview } from "./stroke.svelte";
  import { startDrawingPersistence } from "./persistence.svelte";
  import { drawingTileStore, tileWorldOrigin } from "./tileStore.svelte";
  import { DRAW_TILE_SIZE_UNITS, type TileKey } from "./types";

  interface RasterCanvasParams {
    key: string;
    source: HTMLCanvasElement | null;
    revision: number;
    changedKeys: readonly string[];
    rasterX?: number;
    rasterY?: number;
    dirtyRect?: { x: number; y: number; width: number; height: number } | null;
  }

  interface VisibleTile {
    key: TileKey;
    source: HTMLCanvasElement;
    left: number;
    top: number;
  }

  const transform = $derived(
    `translate(${viewport.width / 2}px, ${viewport.height / 2}px) scale(${camera.zoom * PX_PER_UNIT}) translate(${-camera.x}px, ${-camera.y}px)`,
  );

  const visibleTiles = $derived.by(() => {
    const revision = drawingTileStore.revision;
    void revision;
    if (viewport.width <= 0 || viewport.height <= 0) return [];
    const topLeft = screenToWorld(camera, viewport, { x: 0, y: 0 });
    const bottomRight = screenToWorld(camera, viewport, { x: viewport.width, y: viewport.height });
    const margin = DRAW_TILE_SIZE_UNITS;
    const keys = drawingTileStore.keysInRect({
      x: Math.min(topLeft.x, bottomRight.x) - margin,
      y: Math.min(topLeft.y, bottomRight.y) - margin,
      width: Math.abs(bottomRight.x - topLeft.x) + margin * 2,
      height: Math.abs(bottomRight.y - topLeft.y) + margin * 2,
    });
    return keys.flatMap((key): VisibleTile[] => {
      const origin = tileWorldOrigin(key);
      const source = drawingTileStore.tile(key, false);
      return origin && source ? [{ key, source, left: origin.x, top: origin.y }] : [];
    });
  });

  const renderRaster: Action<HTMLCanvasElement, RasterCanvasParams> = (canvas, initial) => {
    let previousSource: HTMLCanvasElement | null = null;
    let previousRevision = -1;
    let previousRasterX: number | undefined;
    let previousRasterY: number | undefined;
    let previousWidth = 0;
    let previousHeight = 0;

    function update(params: RasterCanvasParams): void {
      if (!params.source) {
        if (canvas.width !== 1 || canvas.height !== 1) {
          canvas.width = 1;
          canvas.height = 1;
        }
        previousSource = null;
        previousRevision = params.revision;
        previousWidth = 0;
        previousHeight = 0;
        return;
      }
      const sameBounds = previousWidth === params.source.width && previousHeight === params.source.height &&
        previousRasterX === params.rasterX && previousRasterY === params.rasterY;
      if (params.key === "preview" && params.source === previousSource && sameBounds && !params.dirtyRect) {
        previousRevision = params.revision;
        return;
      }
      if (params.key === "preview" && params.source === previousSource && sameBounds && params.dirtyRect) {
        const context = canvas.getContext("2d");
        if (context) {
          const x = params.dirtyRect.x - (params.rasterX ?? 0);
          const y = params.dirtyRect.y - (params.rasterY ?? 0);
          context.drawImage(params.source, x, y, params.dirtyRect.width, params.dirtyRect.height,
            x, y, params.dirtyRect.width, params.dirtyRect.height);
        }
        previousRevision = params.revision;
        return;
      }
      if (params.source === previousSource && params.revision !== previousRevision && !params.changedKeys.includes(params.key)) {
        previousRevision = params.revision;
        return;
      }
      if (canvas.width !== params.source.width) canvas.width = params.source.width;
      if (canvas.height !== params.source.height) canvas.height = params.source.height;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(params.source, 0, 0);
      previousSource = params.source;
      previousRevision = params.revision;
      previousRasterX = params.rasterX;
      previousRasterY = params.rasterY;
      previousWidth = params.source.width;
      previousHeight = params.source.height;
    }

    update(initial);
    return { update };
  };

  onMount(startDrawingPersistence);
</script>

<div class="drawing-layer" aria-hidden="true" data-drawing-layer>
  <div class="drawing-world" style:transform={transform}>
    {#each visibleTiles as tile (tile.key)}
      <canvas
        use:renderRaster={{ key: tile.key, source: tile.source, revision: drawingTileStore.revision, changedKeys: drawingTileStore.lastCommitKeys }}
        class="drawing-tile"
        data-drawing-tile={tile.key}
        style:left="{tile.left}px"
        style:top="{tile.top}px"
        style:width="{DRAW_TILE_SIZE_UNITS}px"
        style:height="{DRAW_TILE_SIZE_UNITS}px"
      ></canvas>
    {/each}
    {#if drawingStrokePreview.source}
      <canvas
        use:renderRaster={{ key: "preview", source: drawingStrokePreview.source, revision: drawingStrokePreview.revision, changedKeys: ["preview"], rasterX: drawingStrokePreview.rasterX, rasterY: drawingStrokePreview.rasterY, dirtyRect: drawingStrokePreview.dirtyRect }}
        class="drawing-preview"
        data-drawing-preview
        style:left="{drawingStrokePreview.rasterX / 20}px"
        style:top="{drawingStrokePreview.rasterY / 20}px"
        style:width="{drawingStrokePreview.source.width / 20}px"
        style:height="{drawingStrokePreview.source.height / 20}px"
      ></canvas>
    {/if}
  </div>
</div>

<style>
  .drawing-layer {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .drawing-world {
    position: absolute;
    inset: 0 auto auto 0;
    width: 100%;
    height: 100%;
    transform-origin: 0 0;
    pointer-events: none;
  }

  .drawing-tile,
  .drawing-preview {
    position: absolute;
    display: block;
    max-width: none;
    pointer-events: none;
  }

  .drawing-preview {
    z-index: 1;
  }
</style>
