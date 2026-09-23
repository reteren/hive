<script lang="ts">
  import Board from "./board/Board.svelte";
  import CoordsIndicator from "./ui/CoordsIndicator.svelte";
  import LeftToolbar from "./ui/LeftToolbar.svelte";
  import RightPanel from "./ui/RightPanel.svelte";
  import TopBar from "./ui/TopBar.svelte";
</script>

<div class="shell">
  <div class="top"><TopBar /></div>
  <div class="left"><LeftToolbar /></div>
  <main class="center">
    <Board />
    <div class="overlay-bottom-right"><CoordsIndicator /></div>
  </main>
  <div class="right"><RightPanel /></div>
</div>

<style>
  .shell {
    display: grid;
    grid-template-columns: auto 1fr auto;
    grid-template-rows: auto 1fr;
    grid-template-areas:
      "top top top"
      "left center right";
    height: 100%;
  }

  .top {
    grid-area: top;
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
    right: 8px;
    bottom: 8px;
    pointer-events: none;
  }
</style>
