<script module lang="ts">
  import "./commands/appCommands.svelte";
  import "./settings/commands.svelte";
  import "./beacons/focusCommands";
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
  import TopBar from "./ui/TopBar.svelte";
  import UndoLog from "./ui/UndoLog.svelte";
  import TasksPanel from "./tasks/TasksPanel.svelte";
  import SequentialRename from "./notes/SequentialRename.svelte";
  import SearchPanel from "./search/SearchPanel.svelte";
  import ObjectsPanel from "./navigation/ObjectsPanel.svelte";
  import TransferNotice from "./transfer/TransferNotice.svelte";
  import SettingsPanel from "./ui/SettingsPanel.svelte";
  import BeaconMenu from "./beacons/BeaconMenu.svelte";
  import TrashPanel from "./trash/TrashPanel.svelte";
  import MapOverlay from "./map/MapOverlay.svelte";

  let undoLogCommand = $derived(getCommand("ui.toggleUndoLog"));
  let undoLogKeys = $derived(undoLogCommand?.keys.map(formatKey).join(", ") ?? "");
</script>

<div class="shell">
  <div class="top"><TopBar /></div>
  <div class="left"><LeftToolbar /></div>
  <main class="center">
    <Board />
    <MapOverlay />
    <BeaconMenu />
    <CommandSearch />
    <KeymapEditor />
    <SequentialRename />
    <SearchPanel />
    <TransferNotice />
    <div class="panel-dock" data-selection-ignore aria-label="Panels">
      <CommandButton commandId="search.open" showLabel labelOverride="Search" className="dock-toggle" />
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
      <CommandButton commandId="ui.toggleTasks" showLabel labelOverride="Tasks" className="dock-toggle" />
      <CommandButton commandId="ui.toggleObjectsPanel" showLabel labelOverride="Objects" className="dock-toggle" />
      <CommandButton commandId="ui.openTrash" showLabel labelOverride="Trash" className="dock-toggle" />
    </div>
    <div class="panel-stack" data-selection-ignore aria-label="Open panels">
      <TasksPanel />
      {#if undoLogPanel.open}<UndoLog />{/if}
      <ObjectsPanel />
      <TrashPanel />
    </div>
    <SettingsPanel />
    <div class="overlay-bottom-right">
      <HistoryToast />
      <CoordsIndicator />
    </div>
  </main>
  <KeyDispatcher />
</div>

<style>
  .shell {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-areas:
      "top top"
      "left center";
    height: 100%;
    min-width: 0;
    min-height: 0;
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

  .panel-dock {
    display: flex;
    position: absolute;
    z-index: 12;
    top: 8px;
    right: 8px;
    align-items: center;
    gap: 4px;
    padding: 2px;
    border: 1px solid #353535;
    border-radius: 4px;
    background: rgb(25 25 25 / 92%);
    box-shadow: 0 3px 10px rgb(0 0 0 / 28%);
  }

  .panel-dock :global(.tooltip-trigger) {
    display: inline-flex;
  }

  .panel-dock :global(.command-button) {
    min-height: 30px;
    border-color: #3e3e3e;
    border-radius: 3px;
    background: var(--bg-panel);
  }

  .panel-dock :global(.command-button.with-label) {
    width: auto;
    min-height: 30px;
    padding-inline: 8px;
  }

  .panel-stack {
    display: flex;
    position: absolute;
    z-index: 7;
    top: 48px;
    right: 8px;
    width: min(300px, calc(100% - 16px));
    max-height: calc(100% - 56px);
    flex-direction: column;
    gap: 6px;
    overflow: auto;
    pointer-events: none;
    scrollbar-color: #505050 #1b1b1b;
    scrollbar-width: thin;
  }

  .panel-stack :global(.tasks-panel),
  .panel-stack :global(.history-panel),
  .panel-stack :global(.objects-panel),
  .panel-stack :global(.trash-panel) {
    position: relative;
    inset: auto;
    width: 100%;
    max-width: none;
    max-height: min(420px, 60vh);
    flex: 0 0 auto;
    margin: 0;
    pointer-events: auto;
  }

  .panel-stack :global(.tasks-tab),
  .panel-stack :global(.objects-tab),
  :global(.search-trigger) {
    display: none !important;
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

  :global(html[data-reduce-motion="true"] *) {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }

  @media (max-width: 520px) {
    .shell {
      grid-template-columns: 32px minmax(0, 1fr);
    }

    .panel-dock {
      flex-direction: column;
      align-items: stretch;
      width: 108px;
    }

    .panel-dock :global(.tooltip-trigger) {
      width: 100%;
    }

    .panel-dock :global(.command-button.with-label),
    .panel-dock .undo-log-toggle {
      width: 100%;
      justify-content: flex-start;
    }

    .panel-stack {
      top: 184px;
      max-height: calc(100% - 192px);
    }
  }

  @media (max-width: 420px) {
    .shell {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas:
        "top"
        "center";
    }

    .left {
      display: none;
    }

    .overlay-bottom-right {
      right: 8px;
      left: 6px;
      max-width: calc(100% - 14px);
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
