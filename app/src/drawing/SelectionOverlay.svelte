<script lang="ts">
  import { camera, viewport } from "../board/camera.svelte";
  import { PX_PER_UNIT, screenToWorld } from "../board/cameraMath";
  import { levelPxPerUnit } from "./types";
  import {
    drawingSelection,
    resizeSelectionArea,
    selectionBoundsWorldPixels,
    type DrawingSelectionArea,
    type RasterPoint,
    type SelectionHandle,
  } from "./selection.svelte";

  // Loading the overlay also registers SELECT's DrawToolHandler implementations.
  let floatingCanvas = $state<HTMLCanvasElement | null>(null);
  let resizeGesture: { pointerId: number; handle: SelectionHandle; area: DrawingSelectionArea } | null = null;

  const worldTransform = $derived(
    `translate(${viewport.width / 2}px, ${viewport.height / 2}px) ` +
      `scale(${camera.zoom}) translate(${-camera.x * PX_PER_UNIT}px, ${-camera.y * PX_PER_UNIT}px)`,
  );
  const area = $derived(drawingSelection.area);
  const displayOffset = $derived(area && drawingSelection.floatingAt
    ? { x: drawingSelection.floatingAt.x - area.x, y: drawingSelection.floatingAt.y - area.y }
    : { x: 0, y: 0 });
  const areaBounds = $derived(area ? selectionBoundsWorldPixels(area) : null);
  const handleSize = $derived(8 / camera.zoom);
  const selectionPath = $derived(area ? pathForArea(area, displayOffset) : null);
  const previewPath = $derived(drawingSelection.preview
    ? pathForPreview(drawingSelection.preview.tool, drawingSelection.preview.points, drawingSelection.preview.level)
    : null);
  /** Board px per raster px of the selection's level. */
  const areaRatio = $derived(PX_PER_UNIT / levelPxPerUnit(area?.level ?? 0));

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

  function pathForArea(value: DrawingSelectionArea, offset: RasterPoint): string {
    const ratio = PX_PER_UNIT / levelPxPerUnit(value.level);
    return pathFromPoints(value.outline.map((point) => ({
      x: (point.x + offset.x) * ratio,
      y: (point.y + offset.y) * ratio,
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

  function pathFromPoints(points: readonly { x: number; y: number }[], close: boolean): string {
    if (points.length === 0) return "";
    return `M ${points[0]!.x} ${points[0]!.y} ${points.slice(1).map((point) => `L ${point.x} ${point.y}`).join(" ")}${close ? " Z" : ""}`;
  }

  function onHandleDown(event: PointerEvent, handle: SelectionHandle): void {
    if (event.button !== 0 || !area) return;
    event.preventDefault();
    event.stopPropagation();
    resizeGesture = { pointerId: event.pointerId, handle, area };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onHandleMove(event: PointerEvent): void {
    const gesture = resizeGesture;
    if (!gesture || gesture.pointerId !== event.pointerId || !drawingSelection.area) return;
    const board = document.querySelector<HTMLElement>(".board");
    if (!board) return;
    const rect = board.getBoundingClientRect();
    const world = screenToWorld(camera, viewport, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    const ppu = levelPxPerUnit(gesture.area.level);
    drawingSelection.area = resizeSelectionArea(gesture.area, gesture.handle, { x: world.x * ppu, y: world.y * ppu });
    drawingSelection.revision += 1;
  }

  function onHandleUp(event: PointerEvent): void {
    if (resizeGesture?.pointerId !== event.pointerId) return;
    resizeGesture = null;
    if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    }
    event.preventDefault();
    event.stopPropagation();
  }

  function onHandleCancel(event: PointerEvent): void {
    const gesture = resizeGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    resizeGesture = null;
    drawingSelection.area = gesture.area;
    drawingSelection.revision += 1;
  }

  function handlePosition(handle: SelectionHandle): { x: number; y: number } {
    const bounds = areaBounds;
    if (!bounds) return { x: 0, y: 0 };
    const dx = handle.includes("w") ? bounds.left : bounds.left + bounds.width;
    const dy = handle.includes("n") ? bounds.top : bounds.top + bounds.height;
    return { x: dx - handleSize / 2, y: dy - handleSize / 2 };
  }

  const handles: readonly SelectionHandle[] = ["nw", "ne", "sw", "se"];
</script>

<div class="drawing-selection-overlay" data-drawing-selection-overlay>
  <div class="drawing-selection-world" style:transform={worldTransform}>
    {#if previewPath}
      <svg class="selection-outline" width={viewport.width} height={viewport.height} aria-hidden="true">
        <path d={previewPath} class="selection-dash" />
      </svg>
    {/if}
    {#if area && selectionPath}
      <svg class="selection-outline" width={viewport.width} height={viewport.height} aria-hidden="true">
        <path d={selectionPath} class="selection-dash" />
      </svg>
      {#if !drawingSelection.floatingAt && areaBounds}
        {#each handles as handle (handle)}
          {@const position = handlePosition(handle)}
          <button
            class="selection-handle"
            type="button"
            data-draw-overlay-control
            data-selection-ignore
            data-selection-handle={handle}
            aria-label={`Resize selection ${handle}`}
            style:left={`${position.x}px`}
            style:top={`${position.y}px`}
            style:width={`${handleSize}px`}
            style:height={`${handleSize}px`}
            onpointerdown={(event) => onHandleDown(event, handle)}
            onpointermove={onHandleMove}
            onpointerup={onHandleUp}
            onpointercancel={onHandleCancel}
            onlostpointercapture={onHandleCancel}
          ></button>
        {/each}
      {/if}
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
</div>

<style>
  .drawing-selection-overlay { position: absolute; z-index: 50; inset: 0; overflow: hidden; pointer-events: none; }
  .drawing-selection-world { position: absolute; inset: 0; transform-origin: 0 0; pointer-events: none; }
  .selection-outline { position: absolute; inset: 0; overflow: visible; pointer-events: none; }
  .selection-dash { fill: none; stroke: #fff; stroke-width: 1px; stroke-dasharray: 4px 3px; animation: selection-march 450ms linear infinite; vector-effect: non-scaling-stroke; }
  .selection-floating { position: absolute; display: block; pointer-events: none; image-rendering: auto; }
  .selection-handle { position: absolute; z-index: 1; box-sizing: border-box; min-width: 0; min-height: 0; padding: 0; transform-origin: center; border: 1px solid #191919; border-radius: 2px; background: #fff; box-shadow: 0 0 0 1px rgb(255 255 255 / 80%); pointer-events: auto; cursor: nwse-resize; touch-action: none; }
  .selection-handle[data-selection-handle="ne"], .selection-handle[data-selection-handle="sw"] { cursor: nesw-resize; }
  .selection-handle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @keyframes selection-march { to { stroke-dashoffset: -7px; } }
  :global(html[data-reduce-motion="true"]) .selection-dash { animation: none; }
</style>
