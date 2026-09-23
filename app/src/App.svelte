<script module lang="ts">
  import "./commands/appCommands.svelte";
</script>

<script lang="ts">
  import { formatKey } from "./commands/keys";
  import { getCommand } from "./commands/registry.svelte";
  import KeyDispatcher from "./commands/KeyDispatcher.svelte";
  import Board from "./board/Board.svelte";
  import { toggleUndoLog, undoLogPanel } from "./history/history.svelte";
  import CommandSearch from "./ui/CommandSearch.svelte";
  import KeymapEditor from "./ui/KeymapEditor.svelte";
  import CommandButton from "./ui/CommandButton.svelte";
  import CoordsIndicator from "./ui/CoordsIndicator.svelte";
  import HistoryToast from "./ui/HistoryToast.svelte";
  import LeftToolbar from "./ui/LeftToolbar.svelte";
  import RightPanel from "./ui/RightPanel.svelte";
  import TopBar from "./ui/TopBar.svelte";
  import UndoLog from "./ui/UndoLog.svelte";
  import SequentialRename from "./notes/SequentialRename.svelte";
  import SearchPanel from "./search/SearchPanel.svelte";
  import ObjectsPanel from "./navigation/ObjectsPanel.svelte";
  import { display } from "./settings/display.svelte";

  let undoLogCommand = $derived(getCommand("ui.toggleUndoLog"));
  let undoLogKeys = $derived(undoLogCommand?.keys.map(formatKey).join(", ") ?? "");
</script>

<div class="shell" class:panel-collapsed={!display.rightPanelOpen}>
  <div class="top"><TopBar /></div>
  <div class="left"><LeftToolbar /></div>
  <main class="center">
    <Board />
    <CommandSearch />
    <KeymapEditor />
    <SequentialRename />
    <SearchPanel />
    <ObjectsPanel />
    <div class="upper-controls">
      <CommandButton commandId="ui.commandSearch" />
      <button
        class="undo-log-toggle"
        class:active={undoLogPanel.open}
        type="button"
        aria-label={`Undo log${undoLogKeys ? `; ${undoLogKeys}` : ""}`}
        aria-controls="undo-log-panel"
        aria-expanded={undoLogPanel.open}
        aria-pressed={undoLogPanel.open}
        title={`Undo log${undoLogKeys ? ` · ${undoLogKeys}` : ""}`}
        onclick={toggleUndoLog}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" />
          <circle cx="6" cy="5.5" r="1.1" />
          <circle cx="11" cy="10" r="1.1" />
          <circle cx="8" cy="14.5" r="1.1" />
        </svg>
        <span>Undo log</span>
        {#if undoLogKeys}<kbd>{undoLogKeys}</kbd>{/if}
      </button>
    </div>
    {#if undoLogPanel.open}
      <UndoLog />
    {/if}
    <div class="overlay-bottom-right">
      <HistoryToast />
      <CoordsIndicator />
    </div>
  </main>
  {#if display.rightPanelOpen}
    <div class="right"><RightPanel /></div>
  {/if}
  <KeyDispatcher />
</div>

<style>
  .shell {
    --right-panel-size: 186px;
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr) var(--right-panel-size);
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-areas:
      "top top top"
      "left center right";
    height: 100%;
    min-width: 0;
    min-height: 0;
  }

  .shell.panel-collapsed {
    --right-panel-size: 0px;
    grid-template-columns: 34px minmax(0, 1fr);
    grid-template-areas:
      "top top"
      "left center";
  }

  .top {
    grid-area: top;
    position: relative;
    z-index: 10;
  }

  .left {
    grid-area: left;
    min-height: 0;
  }

  .center {
    grid-area: center;
    position: relative;
    min-width: 0;
    min-height: 0;
  }

  .undo-log-toggle {
    display: inline-flex;
    min-height: 30px;
    align-items: center;
    gap: 7px;
    padding: 4px 8px;
    border: 1px solid #3e3e3e;
    border-radius: 3px;
    background: var(--bg-panel);
    color: var(--text-dim);
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }

  .upper-controls {
    display: flex;
    position: absolute;
    z-index: 6;
    top: 8px;
    right: 8px;
    align-items: center;
    gap: 4px;
  }

  .undo-log-toggle svg {
    width: 14px;
    height: 14px;
    flex: 0 0 auto;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-width: 1.2;
  }

  .undo-log-toggle kbd {
    padding-left: 6px;
    border-left: 1px solid #474747;
    color: var(--text-dim);
    font-family: var(--mono-font);
    font-size: 9px;
  }

  .undo-log-toggle:hover,
  .undo-log-toggle.active {
    border-color: #806b2d;
    background: #343019;
    color: #fff0be;
  }

  .right {
    grid-area: right;
    width: 100%;
    min-width: 0;
    min-height: 0;
  }

  .overlay-bottom-right {
    display: flex;
    position: absolute;
    right: 8px;
    bottom: 8px;
    max-width: calc(100% - 16px);
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
    pointer-events: none;
  }

  @media (max-width: 520px) {
    .shell {
      --right-panel-size: 158px;
      grid-template-columns: 32px minmax(0, 1fr) var(--right-panel-size);
    }

    .shell.panel-collapsed {
      grid-template-columns: 32px minmax(0, 1fr);
    }
  }

  @media (max-width: 420px) {
    .shell,
    .shell.panel-collapsed {
      --right-panel-size: 0px;
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas:
        "top"
        "center";
    }

    .left {
      display: none;
    }

    .right {
      position: fixed;
      top: 67px;
      right: 0;
      bottom: 0;
      z-index: 8;
      width: min(164px, calc(100vw - 44px));
      min-height: 0;
      border-left: 1px solid var(--border);
    }

    .shell:not(.panel-collapsed) {
      --right-panel-size: min(164px, calc(100vw - 44px));
    }

    .overlay-bottom-right {
      right: calc(var(--right-panel-size) + 8px);
      left: 6px;
      max-width: calc(100% - var(--right-panel-size) - 14px);
    }

    .overlay-bottom-right :global(.coords) {
      max-width: 100%;
      flex-wrap: wrap;
      gap: 4px;
      padding: 4px;
      white-space: normal;
    }
  }

  @media (max-width: 320px) {
    .overlay-bottom-right :global(.coords) {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      justify-items: start;
    }

    .overlay-bottom-right :global(.coords > .source),
    .overlay-bottom-right :global(.coords > .zoom) {
      display: none;
    }

    .overlay-bottom-right :global(.coords > span) {
      min-width: 0;
      overflow-wrap: anywhere;
    }
  }
</style>
