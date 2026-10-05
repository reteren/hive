<script lang="ts">
  import { onDestroy } from "svelte";
  import { camera, viewport } from "../board/camera.svelte";
  import { PX_PER_UNIT } from "../board/cameraMath";
  import { drawingGpu } from "./gpu/glEngine";
  import { selectionOutlineMetrics } from "./selectionOutline";
  import { levelPxPerUnit } from "./types";
  import {
    drawingSelection,
    clearDrawingSelection,
    selectionBoundsWorldPixels,
    type DrawingSelectionArea,
    type RasterPoint,
  } from "./selection.svelte";

  // Loading the overlay also registers SELECT's DrawToolHandler implementations.
  let floatingCanvas = $state<HTMLCanvasElement | null>(null);
  let fastPreviewHost = $state<HTMLDivElement | null>(null);
  let maskedDrawingCanvas: HTMLCanvasElement | null = null;
  let originalCanvasMask = "";
  let originalCanvasWebkitMask = "";

  const worldTransform = $derived(
    `translate(${viewport.width / 2}px, ${viewport.height / 2}px) ` +
      `scale(${camera.zoom}) translate(${-camera.x * PX_PER_UNIT}px, ${-camera.y * PX_PER_UNIT}px)`,
  );
  const area = $derived(drawingSelection.area);
  const scalePreview = $derived(drawingSelection.transformPreview);
  const scaleFactor = $derived(scalePreview?.factor ?? 1);
  const displayOffset = $derived(!scalePreview && area && drawingSelection.floatingAt
    ? { x: drawingSelection.floatingAt.x - area.x, y: drawingSelection.floatingAt.y - area.y }
    : { x: 0, y: 0 });
  const areaBounds = $derived(area ? selectionBoundsWorldPixels(area) : null);
  const clearButtonSize = $derived.by(() => {
    void viewport.width;
    return snapToDevicePixel(20);
  });
  const outlineMetrics = $derived(selectionOutlineMetrics(camera.zoom));
  const selectionPath = $derived(area ? pathForArea(area, displayOffset) : null);
  const sourceMaskPath = $derived(area ? pathForScreenArea(area) : null);
  const previewPath = $derived(drawingSelection.preview
    ? pathForPreview(drawingSelection.preview.tool, drawingSelection.preview.points, drawingSelection.preview.level)
    : null);
  /** Board px per raster px of the selection's level. */
  const areaRatio = $derived(PX_PER_UNIT / levelPxPerUnit(area?.level ?? 0));
  const selectionDisplayBounds = $derived(areaBounds ? {
    left: areaBounds.left + displayOffset.x * areaRatio + (areaBounds.width - areaBounds.width * scaleFactor) / 2,
    top: areaBounds.top + displayOffset.y * areaRatio + (areaBounds.height - areaBounds.height * scaleFactor) / 2,
    width: areaBounds.width * scaleFactor,
    height: areaBounds.height * scaleFactor,
  } : null);
  const selectionScreenBounds = $derived(selectionDisplayBounds ? {
    left: snapToDevicePixel(viewport.width / 2 + (selectionDisplayBounds.left - camera.x * PX_PER_UNIT) * camera.zoom),
    top: snapToDevicePixel(viewport.height / 2 + (selectionDisplayBounds.top - camera.y * PX_PER_UNIT) * camera.zoom),
    width: selectionDisplayBounds.width * camera.zoom,
    height: selectionDisplayBounds.height * camera.zoom,
  } : null);
  const minimumMarkerBounds = $derived(selectionScreenBounds
    ? minimumOnScreenMarkerBounds(selectionScreenBounds)
    : null);
  const visibleBounds = $derived(minimumMarkerBounds ?? selectionScreenBounds);

  $effect(() => {
    const canvas = floatingCanvas;
    const pixels = drawingSelection.floating;
    if (!canvas || !pixels) return;
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, pixels.width, pixels.height);
    context.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
  });

  $effect(() => {
    const host = fastPreviewHost;
    const preview = drawingSelection.fastPreview;
    if (!host) return;
    if (!preview) {
      host.replaceChildren();
      return;
    }
    const canvas = preview.canvas;
    if (canvas.parentElement !== host) host.replaceChildren(canvas);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    canvas.style.transform = `translate(${preview.offsetX}px, ${preview.offsetY}px) scale(${preview.scale ?? 1})`;
    canvas.style.transformOrigin = `${preview.originX ?? 0}px ${preview.originY ?? 0}px`;
  });

  $effect(() => {
    const canvas = drawingGpu()?.canvas ?? null;
    const preview = drawingSelection.fastPreview;
    const mask = preview?.hideSource && sourceMaskPath ? "url(#drawing-selection-source-mask)" : "";
    if (!canvas) return;
    if (maskedDrawingCanvas !== canvas) {
      restoreDrawingCanvasMask();
      maskedDrawingCanvas = canvas;
      originalCanvasMask = canvas.style.mask;
      originalCanvasWebkitMask = canvas.style.getPropertyValue("-webkit-mask");
    }
    if (canvas.style.mask !== mask) canvas.style.mask = mask || originalCanvasMask;
    if (canvas.style.getPropertyValue("-webkit-mask") !== mask) {
      canvas.style.setProperty("-webkit-mask", mask || originalCanvasWebkitMask);
    }
  });

  onDestroy(restoreDrawingCanvasMask);

  function pathForArea(value: DrawingSelectionArea, offset: RasterPoint): string {
    const ratio = PX_PER_UNIT / levelPxPerUnit(value.level);
    const factor = drawingSelection.transformPreview?.factor ?? 1;
    const centerX = value.x + value.width / 2;
    const centerY = value.y + value.height / 2;
    return pathFromPoints(value.outline.map((point) => ({
      x: (centerX + (point.x - centerX) * factor + offset.x) * ratio,
      y: (centerY + (point.y - centerY) * factor + offset.y) * ratio,
    })), true);
  }

  function pathForPreview(tool: string, points: readonly RasterPoint[], level: number): string {
    const ratio = PX_PER_UNIT / levelPxPerUnit(level);
    if (tool === "select-rect" && points.length >= 2) {
      const first = points[0]!;
      const last = points.at(-1)!;
      const left = Math.min(first.x, last.x) * ratio;
      const top = Math.min(first.y, last.y) * ratio;
      const right = Math.max(first.x, last.x) * ratio;
      const bottom = Math.max(first.y, last.y) * ratio;
      return pathFromPoints([{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }], true);
    }
    return pathFromPoints(points.map((point) => ({ x: point.x * ratio, y: point.y * ratio })), tool === "select-polygon");
  }

  function pathForScreenArea(value: DrawingSelectionArea): string {
    const ratio = PX_PER_UNIT / levelPxPerUnit(value.level);
    return pathFromPoints(value.outline.map((point) => ({
      x: viewport.width / 2 + (point.x * ratio - camera.x * PX_PER_UNIT) * camera.zoom,
      y: viewport.height / 2 + (point.y * ratio - camera.y * PX_PER_UNIT) * camera.zoom,
    })), true);
  }

  function restoreDrawingCanvasMask(): void {
    if (!maskedDrawingCanvas) return;
    maskedDrawingCanvas.style.mask = originalCanvasMask;
    maskedDrawingCanvas.style.setProperty("-webkit-mask", originalCanvasWebkitMask);
    maskedDrawingCanvas = null;
    originalCanvasMask = "";
    originalCanvasWebkitMask = "";
  }

  function pathFromPoints(points: readonly { x: number; y: number }[], close: boolean): string {
    if (points.length === 0) return "";
    return `M ${points[0]!.x} ${points[0]!.y} ${points.slice(1).map((point) => `L ${point.x} ${point.y}`).join(" ")}${close ? " Z" : ""}`;
  }

  function minimumOnScreenMarkerBounds(
    bounds: { left: number; top: number; width: number; height: number },
  ): { left: number; top: number; width: number; height: number } | null {
    if (Math.max(bounds.width, bounds.height) >= 12) return null;
    const size = 16;
    return {
      left: snapToDevicePixel(bounds.left + bounds.width / 2 - size / 2),
      top: snapToDevicePixel(bounds.top + bounds.height / 2 - size / 2),
      width: size,
      height: size,
    };
  }

  function snapToDevicePixel(value: number): number {
    const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    return Math.round(value * ratio) / ratio;
  }

  const clearButtonPosition = $derived(visibleBounds ? {
    left: snapToDevicePixel(visibleBounds.left + visibleBounds.width - clearButtonSize / 2),
    top: snapToDevicePixel(visibleBounds.top - clearButtonSize / 2),
  } : { left: 0, top: 0 });
</script>

<div class="drawing-selection-overlay" data-drawing-selection-overlay>
  <svg class="selection-mask-defs" width={viewport.width} height={viewport.height} aria-hidden="true">
    <defs>
      <mask id="drawing-selection-source-mask" x="0" y="0" width={viewport.width} height={viewport.height} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse">
        <rect x="0" y="0" width={viewport.width} height={viewport.height} fill="white" />
        {#if drawingSelection.fastPreview?.hideSource && sourceMaskPath}
          <path d={sourceMaskPath} fill="black" />
        {/if}
      </mask>
    </defs>
  </svg>
  <div class="selection-fast-preview-host" bind:this={fastPreviewHost} aria-hidden="true" data-selection-fast-preview></div>
  <div class="drawing-selection-world" style:transform={worldTransform}>
    {#if previewPath}
      <svg class="selection-outline" width={viewport.width} height={viewport.height} aria-hidden="true">
        <path d={previewPath} class="selection-underlay" style={`stroke-width: ${outlineMetrics.underlayStrokeWidth}px`} />
        <path
          d={previewPath}
          class="selection-dash"
          style={`stroke-width: ${outlineMetrics.dashStrokeWidth}px; stroke-dasharray: ${outlineMetrics.dashLength}px ${outlineMetrics.dashGap}px; --selection-dash-offset: ${outlineMetrics.dashOffset}px`}
        />
      </svg>
    {/if}
    {#if area && selectionPath}
      <svg class="selection-outline" width={viewport.width} height={viewport.height} aria-hidden="true">
        <path d={selectionPath} class="selection-underlay" style={`stroke-width: ${outlineMetrics.underlayStrokeWidth}px`} />
        <path
          d={selectionPath}
          class="selection-dash"
          style={`stroke-width: ${outlineMetrics.dashStrokeWidth}px; stroke-dasharray: ${outlineMetrics.dashLength}px ${outlineMetrics.dashGap}px; --selection-dash-offset: ${outlineMetrics.dashOffset}px`}
        />
      </svg>
    {/if}
    {#if drawingSelection.floating && drawingSelection.floatingAt}
      <canvas
        bind:this={floatingCanvas}
        class="selection-floating"
        data-selection-floating
        style:left={`${drawingSelection.floatingAt.x * areaRatio}px`}
        style:top={`${drawingSelection.floatingAt.y * areaRatio}px`}
        style:width={`${drawingSelection.floating.width * areaRatio}px`}
        style:height={`${drawingSelection.floating.height * areaRatio}px`}
      ></canvas>
    {/if}
  </div>
  {#if area && selectionPath && minimumMarkerBounds}
    <div
      class="selection-minimum-marker"
      aria-hidden="true"
      style:left={`${minimumMarkerBounds.left}px`}
      style:top={`${minimumMarkerBounds.top}px`}
      style:width={`${minimumMarkerBounds.width}px`}
      style:height={`${minimumMarkerBounds.height}px`}
    ></div>
  {/if}
  {#if area && selectionPath && !drawingSelection.floatingAt && visibleBounds}
    <button
      class="selection-clear"
      type="button"
      data-draw-overlay-control
      data-selection-clear
      aria-label="Clear selection (Esc)"
      title="Clear selection (Esc)"
      style:left={`${clearButtonPosition.left}px`}
      style:top={`${clearButtonPosition.top}px`}
      style:width={`${clearButtonSize}px`}
      style:height={`${clearButtonSize}px`}
      onclick={clearDrawingSelection}
    ><svg class="selection-clear-glyph" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2 10 10 M10 2 2 10" /></svg></button>
  {/if}
</div>

<style>
  .drawing-selection-overlay { position: absolute; z-index: 50; inset: 0; overflow: hidden; pointer-events: none; }
  .selection-mask-defs { position: absolute; z-index: -1; inset: 0; overflow: visible; pointer-events: none; }
  .selection-fast-preview-host { position: absolute; z-index: 0; inset: 0; overflow: hidden; pointer-events: none; }
  .selection-fast-preview-host :global(canvas) { position: absolute; inset: 0 auto auto 0; display: block; pointer-events: none; }
  .drawing-selection-world { position: absolute; z-index: 1; inset: 0; transform-origin: 0 0; pointer-events: none; }
  .selection-outline { position: absolute; inset: 0; overflow: visible; pointer-events: none; }
  .selection-underlay { fill: none; stroke: #171717; stroke-linecap: round; stroke-linejoin: round; }
  .selection-dash { fill: none; stroke: #fff; stroke-linecap: butt; stroke-linejoin: round; animation: selection-march 450ms linear infinite; }
  .selection-minimum-marker { position: absolute; z-index: 2; box-sizing: border-box; border: 1px dashed #171717; outline: 1px solid #fff; outline-offset: -3px; background: rgb(255 255 255 / 8%); pointer-events: none; }
  .selection-floating { position: absolute; display: block; pointer-events: none; image-rendering: auto; }
  .selection-clear { position: absolute; z-index: 3; display: grid; place-items: center; box-sizing: border-box; min-width: 0; min-height: 0; padding: 0; border: 1px solid #111; border-radius: 50%; background: #fff; color: #111; box-shadow: 0 1px 5px rgb(0 0 0 / 50%); pointer-events: auto; cursor: pointer; }
  .selection-clear-glyph { display: block; width: 12px; height: 12px; overflow: visible; }
  .selection-clear-glyph path { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
  .selection-clear:hover { filter: brightness(1.12); }
  .selection-clear:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
  @keyframes selection-march { to { stroke-dashoffset: var(--selection-dash-offset); } }
  :global(html[data-reduce-motion="true"]) .selection-dash { animation: none; }
  :global(html[data-drawing-mode="true"][data-selection-move-hover="true"] .board) { cursor: move !important; }
  :global(html[data-drawing-mode="true"][data-selection-scale-cursor="nwse"] .board) { cursor: nwse-resize !important; }
  :global(html[data-drawing-mode="true"][data-selection-scale-cursor="nesw"] .board) { cursor: nesw-resize !important; }
  :global(html[data-selection-move-hover="true"] [data-draw-cursor]),
  :global(html[data-selection-move-hover="true"] [data-draw-reticle]),
  :global(html[data-selection-scale-cursor] [data-draw-cursor]),
  :global(html[data-selection-scale-cursor] [data-draw-reticle]) { visibility: hidden; }
</style>
