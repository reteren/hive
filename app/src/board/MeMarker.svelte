<script lang="ts">
  import { camera, viewport, ME_POSITION } from "./camera.svelte";
  import { worldToScreen } from "./cameraMath";

  const screen = $derived(worldToScreen(camera, viewport, ME_POSITION));
</script>

<div class="me" style:transform={`translate(${screen.x}px, ${screen.y}px)`}>
  <span class="dot"></span>
  <span class="label">ME</span>
</div>

<style>
  .me {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
  }

  .dot {
    position: absolute;
    left: -6px;
    top: -6px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 3px rgba(232, 176, 48, 0.25);
  }

  .label {
    position: absolute;
    left: 10px;
    top: -18px;
    color: var(--accent);
    font-weight: 600;
    letter-spacing: 0.04em;
  }
</style>
