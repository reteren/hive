<script lang="ts">
  import { onMount } from "svelte";
  import { camera, pointer, viewport } from "../board/camera.svelte";
  import { worldToScreen } from "../board/cameraMath";
  import { drawingTools } from "./tools.svelte";
  import { drawCursorDiameter } from "./settings";
  import { attachDrawInput } from "./drawInput";

  let boardOrigin = $state({ x: 0, y: 0 });
  let screenPoint = $derived(pointer.world ? worldToScreen(camera, viewport, pointer.world) : null);
  let cursorSize = $derived(drawCursorDiameter(drawingTools.brush.size));

  onMount(() => {
    const board = document.querySelector<HTMLElement>(".board");
    if (!board) return;

    const updateOrigin = () => {
      const rect = board.getBoundingClientRect();
      boardOrigin = { x: rect.left, y: rect.top };
    };
    updateOrigin();
    const observer = new ResizeObserver(updateOrigin);
    observer.observe(board);
    window.addEventListener("resize", updateOrigin);
    window.addEventListener("scroll", updateOrigin, true);
    const previousDrawingMode = document.documentElement.dataset.drawingMode;
    document.documentElement.dataset.drawingMode = "true";
    const detachDrawInput = attachDrawInput(board);

    return () => {
      detachDrawInput();
      observer.disconnect();
      window.removeEventListener("resize", updateOrigin);
      window.removeEventListener("scroll", updateOrigin, true);
      if (previousDrawingMode === undefined) delete document.documentElement.dataset.drawingMode;
      else document.documentElement.dataset.drawingMode = previousDrawingMode;
    };
  });

  let cursorStyle = $derived(screenPoint
    ? `left:${boardOrigin.x + screenPoint.x}px;top:${boardOrigin.y + screenPoint.y}px;--draw-cursor-size:${cursorSize}px`
    : "");
</script>

{#if screenPoint}
  {#if drawingTools.active === "fill"}
    <svg class="draw-cursor draw-cursor-fill" style={cursorStyle} viewBox="0 0 24 24" data-draw-cursor data-tool="fill" aria-hidden="true">
      <path d="M7 3.8 17.3 14l-4.1 1.1-1.1 4.1L1.8 9z" />
      <path d="m14.6 6.3 3.2-3.2M16.5 17.5h.01M19.4 14.6h.01M20 20h.01" />
    </svg>
  {:else}
    <span
      class="draw-cursor"
      class:eraser={drawingTools.active === "eraser"}
      style={cursorStyle}
      data-draw-cursor
      data-tool={drawingTools.active}
      data-size-px={cursorSize}
      aria-hidden="true"
    ></span>
  {/if}
{/if}

<style>
  .draw-cursor {
    position: fixed;
    z-index: 30;
    left: 0;
    top: 0;
    width: var(--draw-cursor-size);
    height: var(--draw-cursor-size);
    box-sizing: border-box;
    transform: translate(-50%, -50%);
    border: 1px solid #111;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px #fff;
    pointer-events: none;
  }

  .draw-cursor.eraser {
    border-style: dashed;
  }

  .draw-cursor-fill {
    width: 22px;
    height: 22px;
    overflow: visible;
    fill: #fff;
    stroke: #111;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.5px;
  }

  :global(html[data-drawing-mode="true"] .board) { cursor: none !important; }
</style>
