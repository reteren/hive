<script lang="ts">
  import { registerCommand } from "./commands/registry.svelte";
  import KeyDispatcher from "./commands/KeyDispatcher.svelte";
  import Board from "./board/Board.svelte";
  import CoordsIndicator from "./ui/CoordsIndicator.svelte";
  import LeftToolbar from "./ui/LeftToolbar.svelte";
  import RightPanel from "./ui/RightPanel.svelte";
  import TopBar from "./ui/TopBar.svelte";

  let rightPanelOpen = $state(true);

  registerCommand({
    id: "ui.toggleRightPanel",
    label: "Toggle Display Panel",
    keys: ["KeyN"],
    run: () => {
      rightPanelOpen = !rightPanelOpen;
    },
    isActive: () => rightPanelOpen,
  });
</script>

<div class="shell" class:panel-collapsed={!rightPanelOpen}>
  <div class="top"><TopBar /></div>
  <div class="left"><LeftToolbar /></div>
  <main class="center">
    <Board />
    <div class="overlay-bottom-right"><CoordsIndicator /></div>
  </main>
  {#if rightPanelOpen}
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

  .right {
    grid-area: right;
    min-height: 0;
  }

  .overlay-bottom-right {
    position: absolute;
    right: calc(var(--right-panel-size) + 8px);
    bottom: 8px;
    max-width: calc(100% - var(--right-panel-size) - 16px);
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
      right: calc(var(--right-panel-size) + 6px);
      left: 6px;
      max-width: none;
    }

    .overlay-bottom-right :global(.coords) {
      max-width: 100%;
      flex-wrap: wrap;
      gap: 4px;
      padding: 4px;
      white-space: normal;
    }
  }
</style>
