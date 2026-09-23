<script lang="ts">
  import { onMount } from "svelte";
  import { viewport } from "./camera.svelte";
  import { attachCameraInput } from "./cameraInput";
  import GridLayer from "./GridLayer.svelte";
  import MeMarker from "./MeMarker.svelte";
  import NotesLayer from "../notes/NotesLayer.svelte";
  import SelectionLayer from "../selection/SelectionLayer.svelte";

  let board: HTMLDivElement;

  onMount(() => {
    const observer = new ResizeObserver(([entry]) => {
      viewport.width = entry.contentRect.width;
      viewport.height = entry.contentRect.height;
    });
    observer.observe(board);
    const detachInput = attachCameraInput(board);
    return () => {
      observer.disconnect();
      detachInput();
    };
  });
</script>

<div class="board" bind:this={board} tabindex="-1">
  <GridLayer />
  <MeMarker />
  <NotesLayer />
  <SelectionLayer />
</div>

<style>
  .board {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--bg-board);
    outline: none;
  }
</style>
