<script lang="ts">
  import { camera } from "../board/camera.svelte";
  import CommandButton from "./CommandButton.svelte";
  import GridControls from "./GridControls.svelte";

  let zoomPercent = $derived(Math.round(camera.zoom * 100));
</script>

<!-- Top toolbar (R0.4): general tools centred, Grid controls. -->
<header class="top-bar">
  <div class="brand" aria-label="hive">hive</div>
  <div class="toolbar-center">
    <div class="view-commands" aria-label="View commands">
      <CommandButton commandId="view.home" />
      <CommandButton commandId="view.zoomOut" />
      <output class="zoom-level" aria-label="Zoom level">{zoomPercent}%</output>
      <CommandButton commandId="view.zoomIn" />
      <CommandButton commandId="view.zoomReset" />
    </div>
    <div class="grid-slot" aria-label="Grid controls">
      <GridControls />
    </div>
  </div>
  <div class="top-actions">
    <CommandButton commandId="ui.toggleRightPanel" />
  </div>
</header>

<style>
  .top-bar {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) 34px;
    align-items: center;
    min-height: 36px;
    padding: 3px 5px;
    background: var(--bg-panel);
    border-bottom: 1px solid var(--border);
  }

  .brand {
    padding-left: 4px;
    color: #e8b030;
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.02em;
  }

  .toolbar-center {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .view-commands {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 1px;
  }

  .zoom-level {
    min-width: 35px;
    color: var(--text-dim);
    font-family: var(--mono-font);
    font-size: 11px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .grid-slot {
    display: flex;
    min-width: 0;
    align-items: center;
    padding-left: 7px;
    border-left: 1px solid #3c3c3c;
  }

  .top-actions {
    display: flex;
    justify-content: flex-end;
  }

  @media (max-width: 420px) {
    .top-bar {
      grid-template-columns: minmax(0, 1fr) 32px;
      row-gap: 2px;
      padding: 3px 4px;
    }

    .brand {
      display: none;
    }

    .toolbar-center {
      grid-column: 1;
      grid-row: 1;
      flex-wrap: wrap;
      row-gap: 3px;
    }

    .top-actions {
      grid-column: 2;
      grid-row: 1;
    }

    .grid-slot {
      flex: 1 1 100%;
      justify-content: center;
      padding: 2px 0 0;
      border-top: 1px solid #3c3c3c;
      border-left: 0;
    }
  }
</style>
