<script lang="ts">
  import { camera } from "../board/camera.svelte";
  import CommandButton from "./CommandButton.svelte";
  import GridControls from "./GridControls.svelte";
  import ConflictNotice from "./ConflictNotice.svelte";
  import MenuBar from "./menubar/MenuBar.svelte";
  import { project } from "../project/project.svelte";

  let { onMenuOpenChange = () => {} } = $props<{ onMenuOpenChange?: (open: boolean) => void }>();

  let zoomPercent = $derived(Math.round(camera.zoom * 100));
</script>

<!-- Top toolbar (R0.4): general tools centred, Grid controls. -->
<header class="top-bar">
  <div class="brand" aria-label="hive">
    <span class="brand-mark">hive</span>
    <MenuBar onOpenChange={onMenuOpenChange} />
    <span class="project-name" title={`Project: ${project.name}`}>{project.name}</span>
    {#if project.error}
      <span class="project-error-indicator" role="status" title={project.error}>Save failed: {project.error}</span>
    {/if}
    {#if project.warnings.length > 0}
      <span class="project-warning-indicator" role="status" title={project.warnings.join("\n")}>Warning: {project.warnings[0]}</span>
    {/if}
  </div>
  <div class="toolbar-center">
    <div class="view-commands" aria-label="View commands">
      <CommandButton commandId="view.zoomOut" />
      <output class="zoom-level" aria-label="Zoom level">{zoomPercent}%</output>
      <CommandButton commandId="view.zoomIn" />
    </div>
    <div class="grid-slot" aria-label="Grid controls">
      <GridControls />
    </div>
  </div>
  <div class="top-actions">
    <CommandButton commandId="ui.settings" />
  </div>
  <div class="conflict-status">
    <ConflictNotice />
  </div>
</header>

<style>
  .top-bar {
    position: relative;
    display: grid;
    grid-template-columns: minmax(130px, 1fr) minmax(0, auto) minmax(34px, 1fr);
    align-items: center;
    min-height: 36px;
    padding: 3px 5px;
    background: var(--bg-panel);
    border-bottom: 1px solid var(--border);
  }

  .conflict-status {
    position: absolute;
    z-index: 32;
    top: calc(100% + 3px);
    left: 6px;
    max-width: calc(100vw - 12px);
  }

  .brand {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
    padding-left: 4px;
  }

  .brand-mark {
    color: var(--accent);
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.02em;
  }

  .project-name {
    min-width: 0;
    color: var(--text-dim);
    font-size: 10px;
    max-width: 132px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .project-error-indicator {
    display: block;
    max-width: 210px;
    padding: 3px 0;
    color: #ffaaa2;
    font-size: 9px;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  .project-warning-indicator {
    display: block;
    max-width: 210px;
    padding: 3px 0;
    color: #e7ca78;
    font-size: 9px;
    line-height: 1.3;
    overflow-wrap: anywhere;
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
    gap: 2px;
  }

  @media (max-width: 420px) {
    .top-bar {
      grid-template-columns: minmax(0, 1fr) 60px;
      row-gap: 2px;
      padding: 3px 4px;
    }

    .brand {
      grid-column: 1 / -1;
      grid-row: 1;
      max-width: 100%;
      gap: 5px;
    }

    .project-name {
      max-width: 90px;
      font-size: 9px;
    }

    .toolbar-center {
      grid-column: 1;
      grid-row: 2;
      flex-wrap: wrap;
      row-gap: 3px;
    }

    .top-actions {
      grid-column: 2;
      grid-row: 2;
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
