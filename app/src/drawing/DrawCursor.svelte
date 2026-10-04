<script lang="ts">
  import { onMount } from "svelte";
  import { camera, pointer, viewport } from "../board/camera.svelte";
  import { worldToScreen } from "../board/cameraMath";
  import { brushHint, drawingTools } from "./tools.svelte";
  import { drawCursorDiameter } from "./settings";
  import { attachDrawInput } from "./drawInput";
  import { eyedropper } from "./eyedropper.svelte";

  let boardOrigin = $state({ x: 0, y: 0 });
  let screenPoint = $derived(pointer.world ? worldToScreen(camera, viewport, pointer.world) : null);
  let cursorSize = $derived(drawCursorDiameter(drawingTools.brush.size));
  /** Below this diameter the circle alone gets lost on the board, so four short ticks frame it. */
  const RETICLE_BELOW_PX = 12;
  /** Selection tools work on points, not with a brush footprint: they get the precise reticle only. */
  let pointTool = $derived(drawingTools.active === "select-rect" || drawingTools.active === "select-lasso" || drawingTools.active === "select-polygon");
  let reticleGap = $derived(pointTool ? 3 : cursorSize / 2 + 3);

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

  // The wheel hint stays for a moment after the last adjustment.
  let hintVisible = $state(false);
  $effect(() => {
    if (brushHint.revision === 0) return;
    hintVisible = true;
    const timer = setTimeout(() => { hintVisible = false; }, 900);
    return () => clearTimeout(timer);
  });

  let cursorStyle = $derived(screenPoint
    ? `left:${boardOrigin.x + screenPoint.x}px;top:${boardOrigin.y + screenPoint.y}px;--draw-cursor-size:${cursorSize}px`
    : "");
</script>

{#if screenPoint && hintVisible && !eyedropper.active}
  <div class="brush-hint" style={cursorStyle} data-brush-hint>{brushHint.text}</div>
{/if}
{#if screenPoint && eyedropper.active}
  <!-- Pipette cursor: its tip stops 2 px short of the hotspot so it is never the sampled pixel. -->
  <svg class="eyedropper-cursor" style={cursorStyle} viewBox="0 0 24 24" data-eyedropper-cursor aria-hidden="true">
    <path class="pipette-halo" d="M2.5 21.5 4 17.6l9.2-9.2 2.4 2.4-9.2 9.2zM13.2 8.4l2.1-2.1a2.6 2.6 0 0 1 3.7 0 2.6 2.6 0 0 1 0 3.7l-2.1 2.1M12.4 7.6l4 4" />
    <path class="pipette-line" d="M2.5 21.5 4 17.6l9.2-9.2 2.4 2.4-9.2 9.2zM13.2 8.4l2.1-2.1a2.6 2.6 0 0 1 3.7 0 2.6 2.6 0 0 1 0 3.7l-2.1 2.1M12.4 7.6l4 4" />
  </svg>
  <div class="eyedropper-preview" style={cursorStyle} data-eyedropper aria-live="polite">
    <span class="eyedropper-swatch" class:empty={!eyedropper.color} style:background={eyedropper.color ?? "transparent"}></span>
    <span class="eyedropper-hex">{eyedropper.color ?? "—"}</span>
  </div>
{/if}
<!-- The eyedropper reads the real screen pixel under the hotspot, so the brush cursor steps aside. -->
{#if screenPoint && !eyedropper.active}
  {#if drawingTools.active === "fill"}
    <svg class="draw-cursor draw-cursor-fill" style={cursorStyle} viewBox="0 0 24 24" data-draw-cursor data-tool="fill" aria-hidden="true">
      <path d="M7 3.8 17.3 14l-4.1 1.1-1.1 4.1L1.8 9z" />
      <path d="m14.6 6.3 3.2-3.2M16.5 17.5h.01M19.4 14.6h.01M20 20h.01" />
    </svg>
  {:else}
    {#if pointTool || cursorSize < RETICLE_BELOW_PX}
      <svg class="draw-reticle" style={cursorStyle} viewBox="-16 -16 32 32" data-draw-reticle aria-hidden="true">
        {#each [0, 90, 180, 270] as angle (angle)}
          <g transform={`rotate(${angle})`}>
            <line class="reticle-halo" x1={reticleGap} y1="0" x2={reticleGap + 5} y2="0" />
            <line class="reticle-tick" x1={reticleGap} y1="0" x2={reticleGap + 5} y2="0" />
          </g>
        {/each}
      </svg>
    {/if}
    <span
      class="draw-cursor"
      class:point={pointTool}
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

  .draw-cursor.point {
    width: 3px;
    height: 3px;
    border: 0;
    background: #fff;
    box-shadow: 0 0 0 1px rgb(17 17 17 / 85%);
  }

  .eyedropper-cursor {
    position: fixed;
    z-index: 10002;
    left: 0;
    top: 0;
    width: 22px;
    height: 22px;
    overflow: visible;
    pointer-events: none;
    /* The pipette tip (2.5, 21.5) sits 2 px up-right of the hotspot. */
    transform: translate(-0.5px, -23.5px);
  }

  .pipette-halo {
    fill: none;
    stroke: rgb(17 17 17 / 90%);
    stroke-width: 3.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .pipette-line {
    fill: rgb(255 255 255 / 18%);
    stroke: #fff;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .draw-reticle {
    position: fixed;
    z-index: 30;
    left: 0;
    top: 0;
    width: 32px;
    height: 32px;
    overflow: visible;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  .reticle-halo {
    stroke: rgb(17 17 17 / 85%);
    stroke-width: 3;
    stroke-linecap: round;
  }

  .reticle-tick {
    stroke: rgb(255 255 255 / 92%);
    stroke-width: 1;
    stroke-linecap: round;
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
  .eyedropper-preview {
    position: fixed;
    z-index: 10001;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px 4px 4px;
    border: 1px solid rgb(255 255 255 / 18%);
    border-radius: 6px;
    background: #1e1e1e;
    box-shadow: 0 4px 14px rgb(0 0 0 / 45%);
    color: #e8e8e8;
    font: 12px/1 ui-monospace, "Cascadia Mono", Consolas, monospace;
    pointer-events: none;
    transform: translate(14px, 14px);
  }

  .eyedropper-swatch {
    width: 22px;
    height: 22px;
    border: 1px solid rgb(255 255 255 / 35%);
    border-radius: 4px;
  }

  .eyedropper-swatch.empty {
    background: repeating-conic-gradient(#555 0 25%, #333 0 50%) 0 0 / 8px 8px !important;
  }
  .brush-hint {
    position: fixed;
    z-index: 10001;
    padding: 4px 8px;
    border: 1px solid rgb(255 255 255 / 18%);
    border-radius: 6px;
    background: #1e1e1e;
    box-shadow: 0 4px 14px rgb(0 0 0 / 45%);
    color: #e8e8e8;
    font: 12px/1 system-ui, sans-serif;
    white-space: nowrap;
    pointer-events: none;
    transform: translate(calc(var(--draw-cursor-size) / 2 + 10px), calc(var(--draw-cursor-size) / 2 + 6px));
  }
</style>
