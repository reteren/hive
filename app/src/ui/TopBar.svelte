<script lang="ts">
  import { camera } from "../board/camera.svelte";
  import CommandButton from "./CommandButton.svelte";
  import GridControls from "./GridControls.svelte";
  import { runCommand } from "../commands/registry.svelte";
  import { project } from "../project/project.svelte";

  let zoomPercent = $derived(Math.round(camera.zoom * 100));
</script>

<!-- Top toolbar (R0.4): general tools centred, Grid controls. -->
<header class="top-bar">
  <div class="brand" aria-label="hive">
    <span class="brand-mark">hive</span>
    <div class="project-control">
      <button
        class="project-button"
        class:has-error={project.error}
        type="button"
        aria-haspopup="menu"
        aria-expanded={project.menuOpen}
        title={`Project: ${project.name}${project.error ? ` · ${project.error}` : ""}`}
        onclick={() => (project.menuOpen = !project.menuOpen)}
      >
        <span class="project-name">{project.name}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      {#if project.error}
        <span class="project-error-indicator" role="status" title={project.error}>Save failed: {project.error}</span>
      {/if}
      {#if project.warnings.length > 0}
        <span class="project-warning-indicator" role="status" title={project.warnings.join("\n")}>Warning: {project.warnings[0]}</span>
      {/if}
      {#if project.menuOpen}
        <div class="project-menu" role="menu" aria-label="Project">
          <button role="menuitem" type="button" title="New Project · Ctrl+Shift+N" onclick={() => runCommand("project.new")}>New…</button>
          <button role="menuitem" type="button" title="Open Project · Ctrl+O" onclick={() => runCommand("project.open")}>Open…</button>
          {#if project.error}
            <div class="project-error" role="status">{project.error}</div>
          {/if}
          {#each project.warnings as warning}
            <div class="project-warning" role="status">{warning}</div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
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
    grid-template-columns: minmax(130px, 1fr) minmax(0, auto) minmax(34px, 1fr);
    align-items: center;
    min-height: 36px;
    padding: 3px 5px;
    background: var(--bg-panel);
    border-bottom: 1px solid var(--border);
  }

  .brand {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
    padding-left: 4px;
  }

  .brand-mark {
    color: #e8b030;
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.02em;
  }

  .project-control {
    position: relative;
    min-width: 0;
  }

  .project-button {
    display: flex;
    max-width: 154px;
    min-height: 26px;
    align-items: center;
    gap: 5px;
    padding: 3px 6px;
    border: 1px solid #3b3b3b;
    border-radius: 3px;
    background: #202020;
    color: var(--text-dim);
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }

  .project-button:hover,
  .project-button[aria-expanded="true"] {
    border-color: #666;
    color: var(--text);
  }

  .project-button.has-error {
    border-color: #9b4c46;
    color: #ffaaa2;
  }

  .project-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .project-menu {
    display: grid;
    position: absolute;
    z-index: 30;
    top: calc(100% + 3px);
    left: 0;
    width: 210px;
    gap: 2px;
    padding: 5px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg-panel);
    box-shadow: 0 6px 18px #0008;
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

  .project-menu button {
    padding: 5px 7px;
    border: 0;
    border-radius: 2px;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 10px;
    text-align: left;
    cursor: pointer;
  }

  .project-menu button:hover {
    background: #383838;
  }

  .project-error,
  .project-warning {
    padding: 5px 7px;
    border-top: 1px solid #454545;
    color: #ffaaa2;
    font-size: 9px;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .project-warning {
    color: #e7ca78;
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
