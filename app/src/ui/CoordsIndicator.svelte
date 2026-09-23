<script lang="ts">
  import { camera, pointer } from "../board/camera.svelte";

  const coordinateFormat = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    useGrouping: false,
  });

  let isCenter = $derived(pointer.world === null);
  let position = $derived(pointer.world ?? { x: camera.x, y: camera.y });
  let zoomPercent = $derived(Math.round(camera.zoom * 100));

  function formatCoordinate(value: number): string {
    return coordinateFormat.format(Object.is(value, -0) ? 0 : value);
  }
</script>

<!-- Cursor X/Y indicator in units (R0.3). -->
<div class="coords" aria-label="Board coordinates and zoom">
  <span class="source" class:center={isCenter}>{isCenter ? "CENTER" : "CURSOR"}</span>
  <span><span class="axis-label">X</span> {formatCoordinate(position.x)} <span class="unit">u</span></span>
  <span><span class="axis-label">Y</span> {formatCoordinate(position.y)} <span class="unit">u</span></span>
  <span class="zoom">{zoomPercent}%</span>
</div>

<style>
  .coords {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 7px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg-panel);
    color: var(--text);
    font-family: var(--mono-font);
    font-variant-numeric: tabular-nums;
    font-size: 11px;
    line-height: 1;
    white-space: nowrap;
  }

  .source {
    color: var(--text-dim);
    font-size: 9px;
    letter-spacing: 0.04em;
  }

  .source.center {
    color: var(--accent);
  }

  .axis-label,
  .unit {
    color: var(--text-dim);
  }

  .zoom {
    padding-left: 7px;
    border-left: 1px solid var(--border);
    color: var(--text-dim);
  }
</style>
