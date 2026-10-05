<script module lang="ts">
  import "./commands/appCommands.svelte";
  import "./settings/commands.svelte";
  import "./beacons/focusCommands";
  import "./drawing/commands.svelte";
  import "./ui/dockVisibility.svelte";
</script>

<script lang="ts">
  import { getCommand } from "./commands/registry.svelte";
  import KeyDispatcher from "./commands/KeyDispatcher.svelte";
  import Board from "./board/Board.svelte";
  import { toggleUndoLog, undoLogPanel } from "./history/history.svelte";
  import { closePanelPopup } from "./ui/popups/panelPopupState.svelte";
  import { dockVisibility } from "./ui/dockVisibility.svelte";
  import CommandSearch from "./ui/CommandSearch.svelte";
  import KeymapEditor from "./ui/KeymapEditor.svelte";
  import Tooltip from "./ui/Tooltip.svelte";
  import CoordsIndicator from "./ui/CoordsIndicator.svelte";
  import HistoryToast from "./ui/HistoryToast.svelte";
  import LeftToolbar from "./ui/LeftToolbar.svelte";
  import TopBar from "./ui/TopBar.svelte";
  import UndoLog from "./ui/UndoLog.svelte";
  import TasksPanel from "./tasks/TasksPanel.svelte";
  import { tasksPanel, toggleTasksPanel } from "./tasks/tasksPanelState.svelte";
  import SequentialRename from "./notes/SequentialRename.svelte";
  import SearchPanel from "./search/SearchPanel.svelte";
  import ObjectsPanel from "./navigation/ObjectsPanel.svelte";
  import { objectsPanel, toggleObjectsPanel } from "./navigation/panelState.svelte";
  import TransferNotice from "./transfer/TransferNotice.svelte";
  import SettingsPanel from "./ui/SettingsPanel.svelte";
  import BeaconMenu from "./beacons/BeaconMenu.svelte";
  import TrashPanel from "./trash/TrashPanel.svelte";
  import { toggleTrashPanel, trashPanel } from "./trash/trashPanelState.svelte";
  import PanelPopups from "./ui/popups/PanelPopups.svelte";
  import { closeCommandSearch, commandSearchState } from "./commands/commandSearch.svelte";
  import { closeSearch, searchState } from "./search/search.svelte";
  import MapOverlay from "./map/MapOverlay.svelte";
  import MessageCards from "./messages/MessageCards.svelte";
  import DrawToolbar from "./drawing/DrawToolbar.svelte";
  import ImageEraseLayer from "./attachments/ImageEraseLayer.svelte";
  import NoteGlowPopover from "./notes/NoteGlowPopover.svelte";

  let topMenuOpen = $state(false);
  let undoLogCommand = $derived(getCommand("ui.toggleUndoLog"));
  let tasksCommand = $derived(getCommand("ui.toggleTasks"));
  let objectsCommand = $derived(getCommand("ui.toggleObjectsPanel"));
  let trashCommand = $derived(getCommand("ui.openTrash"));
  let previousSearchOpen = false;
  let anyDockButtonVisible = $derived(
    dockVisibility.undoLog || dockVisibility.tasks || dockVisibility.trash || dockVisibility.objects,
  );

  $effect(() => {
    const searchOpen = searchState.open;
    const commandSearchOpen = commandSearchState.open;
    if (searchOpen && commandSearchOpen) {
      if (searchOpen !== previousSearchOpen) closeCommandSearch();
      else closeSearch();
    }
    if (searchOpen || commandSearchOpen) closePanelPopup(false);
    previousSearchOpen = searchOpen;
  });
</script>

<div class="shell">
  <div class="top" class:menu-open={topMenuOpen}>
    <TopBar onMenuOpenChange={(open) => { topMenuOpen = open; }} />
  </div>
  <div class="left"><LeftToolbar /></div>
  <main class="center">
    <Board />
    <NoteGlowPopover />
    <ImageEraseLayer />
    <DrawToolbar />
    <MapOverlay />
    <BeaconMenu />
    <CommandSearch />
    <KeymapEditor />
    <SequentialRename />
    <SearchPanel />
    <TransferNotice />
    {#if anyDockButtonVisible}
      <div class="panel-dock" data-selection-ignore aria-label="Panels">
        {#if dockVisibility.undoLog}
          <Tooltip label="Undo log" bindings={undoLogCommand?.keys ?? []}>
            <button
              class="dock-button"
              class:active={undoLogPanel.open}
              type="button"
              data-dock-button="undo-log"
              aria-label="Undo log"
              aria-controls="undo-log-panel"
              aria-expanded={undoLogPanel.open}
              aria-pressed={undoLogPanel.open}
              onclick={toggleUndoLog}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                <path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" />
                <circle cx="6" cy="5.5" r="1.1" />
                <circle cx="11" cy="10" r="1.1" />
                <circle cx="8" cy="14.5" r="1.1" />
              </svg>
              <span>Undo log</span>
            </button>
          </Tooltip>
        {/if}
        {#if dockVisibility.tasks}
          <Tooltip label="Tasks" bindings={tasksCommand?.keys ?? []}>
            <button
              class="dock-button"
              class:active={tasksPanel.open}
              type="button"
              data-dock-button="tasks"
              aria-label="Tasks"
              aria-controls="tasks-panel"
              aria-expanded={tasksPanel.open}
              aria-pressed={tasksPanel.open}
              onclick={toggleTasksPanel}
            >Tasks</button>
          </Tooltip>
        {/if}
        {#if dockVisibility.objects}
          <Tooltip label="Objects" bindings={objectsCommand?.keys ?? []}>
            <button
              class="dock-button"
              class:active={objectsPanel.open}
              type="button"
              data-dock-button="objects"
              aria-label="Objects"
              aria-controls="objects-panel"
              aria-expanded={objectsPanel.open}
              aria-pressed={objectsPanel.open}
              onclick={toggleObjectsPanel}
            >Objects</button>
          </Tooltip>
        {/if}
        {#if dockVisibility.trash}
          <Tooltip label="Trash" bindings={trashCommand?.keys ?? []}>
            <button
              class="dock-button"
              class:active={trashPanel.open}
              type="button"
              data-dock-button="trash"
              aria-label="Trash"
              aria-controls="trash-panel"
              aria-expanded={trashPanel.open}
              aria-pressed={trashPanel.open}
              onclick={toggleTrashPanel}
            >Trash</button>
          </Tooltip>
        {/if}
      </div>
    {/if}
    <div class="panel-stack" class:with-dock={anyDockButtonVisible} data-selection-ignore aria-label="Open panels">
      <TasksPanel variant="dock" />
      {#if undoLogPanel.open}<UndoLog variant="dock" />{/if}
      <ObjectsPanel variant="dock" />
      <TrashPanel variant="dock" />
      <MessageCards />
    </div>
    <PanelPopups />
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

  .top.menu-open {
    z-index: 10003;
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

  .dock-button {
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

  .panel-stack {
    display: flex;
    position: absolute;
    z-index: 7;
    top: 8px;
    right: 8px;
    width: min(300px, calc(100% - 16px));
    max-height: calc(100% - 56px);
    flex-direction: column;
    gap: 6px;
    overflow: auto;
    pointer-events: none;
    scrollbar-width: thin;
  }

  .panel-stack.with-dock {
    top: 48px;
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

  .dock-button svg {
    width: 14px;
    height: 14px;
    flex: 0 0 auto;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-width: 1.2;
  }

  .dock-button:hover,
  .dock-button.active {
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

    .panel-dock .dock-button {
      width: 100%;
      justify-content: flex-start;
    }

    .panel-stack {
      max-height: calc(100% - 16px);
    }

    .panel-stack.with-dock {
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
