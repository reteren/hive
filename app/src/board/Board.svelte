<script lang="ts">
  import { onMount } from "svelte";
  import type { Action } from "svelte/action";
  import { viewport } from "./camera.svelte";
  import { attachCameraInput } from "./cameraInput";
  import GridLayer from "./GridLayer.svelte";
  import MeMarker from "./MeMarker.svelte";
  import NotesLayer from "../notes/NotesLayer.svelte";
  import SelectionLayer from "../selection/SelectionLayer.svelte";
  import CreateMenu from "../notes/CreateMenu.svelte";
  import { editing } from "../notes/editing.svelte";
  import { creationMenu } from "../notes/creation.svelte";
  import { isTextEditingTarget } from "../commands/focus";

  let board: HTMLDivElement;

  const boardSurface: Action<HTMLDivElement> = (element) => {
    element.addEventListener("click", onBoardClick);
    return { destroy: () => element.removeEventListener("click", onBoardClick) };
  };

  onMount(() => {
    const observer = new ResizeObserver(([entry]) => {
      viewport.width = entry.contentRect.width;
      viewport.height = entry.contentRect.height;
    });
    observer.observe(board);
    const detachInput = attachCameraInput(board);
    window.addEventListener("keydown", onKeydown);
    return () => {
      observer.disconnect();
      detachInput();
      window.removeEventListener("keydown", onKeydown);
    };
  });

  function onBoardClick(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest("[data-note-id], [data-create-menu]")) return;

    editing.noteId = null;
    if (!creationMenu.pinned) creationMenu.open = false;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.code !== "Escape" || isTextEditingTarget(event.target) || isTextEditingTarget(document.activeElement)) {
      return;
    }

    event.preventDefault();
    editing.noteId = null;
    creationMenu.open = false;
    creationMenu.pinned = false;
  }
</script>

<div
  class="board"
  bind:this={board}
  use:boardSurface
  tabindex="-1"
  role="application"
>
  <GridLayer />
  <MeMarker />
  <NotesLayer />
  <SelectionLayer />
  <CreateMenu />
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
