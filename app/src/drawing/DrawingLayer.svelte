<script lang="ts">
  import { onMount } from "svelte";
  import type { Action } from "svelte/action";
  import { camera, viewport } from "../board/camera.svelte";
  import { PX_PER_UNIT, screenToWorld } from "../board/cameraMath";
  import { drawingStrokePreview } from "./stroke.svelte";
  import { startDrawingPersistence } from "./persistence.svelte";
  import { drawingTileStore, tileWorldOrigin } from "./tileStore.svelte";
  import { levelTileUnits, type TileKey } from "./types";

  interface VisibleTile {
    key: TileKey;
    source: HTMLCanvasElement;
    left: number;
    top: number;
    size: number;
  }

  const transform = $derived(
    `translate(${viewport.width / 2}px, ${viewport.height / 2}px) scale(${camera.zoom * PX_PER_UNIT}) translate(${-camera.x}px, ${-camera.y}px)`,
  );

  /** Tiles of every level in view, coarsest level first (finer detail is displayed on top). */
  const visibleTiles = $derived.by(() => {
    const revision = drawingTileStore.revision;
    void revision;
    if (viewport.width <= 0 || viewport.height <= 0) return [];
    const topLeft = screenToWorld(camera, viewport, { x: 0, y: 0 });
    const bottomRight = screenToWorld(camera, viewport, { x: viewport.width, y: viewport.height });
    const view = {
      x: Math.min(topLeft.x, bottomRight.x),
      y: Math.min(topLeft.y, bottomRight.y),
      width: Math.abs(bottomRight.x - topLeft.x),
      height: Math.abs(bottomRight.y - topLeft.y),
    };
    return drawingTileStore.levels().flatMap((level) => {
      const margin = levelTileUnits(level);
      const keys = drawingTileStore.keysInRect({
        x: view.x - margin,
        y: view.y - margin,
        width: view.width + margin * 2,
        height: view.height + margin * 2,
      }, false, level);
      return keys.flatMap((key): VisibleTile[] => {
        const origin = tileWorldOrigin(key);
        const source = drawingTileStore.tile(key, false);
        return origin && source ? [{ key, source, left: origin.x, top: origin.y, size: origin.size }] : [];
      });
    });
  });

  /**
   * Show a canvas owned by the tile store / live stroke directly (no copy): paint lands on screen as
   * soon as it is drawn, and a tile costs its memory once.
   */
  const mountCanvas: Action<HTMLElement, HTMLCanvasElement | null> = (node, initial) => {
    function update(canvas: HTMLCanvasElement | null): void {
      if (!canvas) {
        node.replaceChildren();
        return;
      }
      if (node.firstChild === canvas) return;
      canvas.classList.add("drawing-canvas");
      node.replaceChildren(canvas);
    }
    update(initial);
    return {
      update,
      destroy() {
        node.replaceChildren();
      },
    };
  };

  onMount(startDrawingPersistence);
</script>

<div class="drawing-layer" aria-hidden="true" data-drawing-layer>
  <div class="drawing-world" style:transform={transform}>
    {#each visibleTiles as tile (tile.key)}
      <div
        use:mountCanvas={tile.source}
        class="drawing-tile"
        data-drawing-tile={tile.key}
        style:left="{tile.left}px"
        style:top="{tile.top}px"
        style:width="{tile.size}px"
        style:height="{tile.size}px"
      ></div>
    {/each}
    {#if drawingStrokePreview.source}
      <div
        use:mountCanvas={drawingStrokePreview.source}
        class="drawing-preview"
        class:erase={drawingStrokePreview.erase}
        data-drawing-preview
        style:left="{drawingStrokePreview.rasterX / drawingStrokePreview.pixelsPerUnit}px"
        style:top="{drawingStrokePreview.rasterY / drawingStrokePreview.pixelsPerUnit}px"
        style:width="{drawingStrokePreview.source.width / drawingStrokePreview.pixelsPerUnit}px"
        style:height="{drawingStrokePreview.source.height / drawingStrokePreview.pixelsPerUnit}px"
        style:opacity={drawingStrokePreview.opacity}
      ></div>
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
    pointer-events: none;
  }

  .drawing-preview {
    z-index: 1;
  }

  .drawing-layer :global(.drawing-canvas) {
    display: block;
    width: 100%;
    height: 100%;
    max-width: none;
    pointer-events: none;
  }
</style>
