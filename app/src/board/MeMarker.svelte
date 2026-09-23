<script lang="ts">
  import { camera, viewport, ME_POSITION } from "./camera.svelte";
  import { pixelsPerUnit, worldToScreen } from "./cameraMath";

  const screen = $derived(worldToScreen(camera, viewport, ME_POSITION));
  // A beacon has a fixed size on the board, like a note: it scales together with the camera zoom.
  const scale = $derived(pixelsPerUnit(camera) / 10);
</script>

<div class="me" style:transform={`translate(${screen.x}px, ${screen.y}px) scale(${scale})`}>
  <span class="dot" data-beacon-id="me"></span>
  <span class="label">ME</span>
</div>

<style>
  /* Sizes below are at zoom 1 (1 u = 10 px): the dot is 7.2 u across (beacon size). */
  .me {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
    pointer-events: none;
  }

  .dot {
    position: absolute;
    left: -36px;
    top: -36px;
    width: 72px;
    height: 72px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 12px rgba(232, 176, 48, 0.25);
    pointer-events: auto;
    cursor: crosshair;
  }

  .label {
    position: absolute;
    left: 46px;
    top: -30px;
    color: var(--accent);
    font-size: 40px;
    font-weight: 600;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
</style>
