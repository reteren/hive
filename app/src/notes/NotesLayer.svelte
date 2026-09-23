<script lang="ts">
  import type { Action } from "svelte/action";
  import { board } from "../model/board.svelte";
  import { camera, viewport } from "../board/camera.svelte";
  import { PX_PER_UNIT } from "../board/cameraMath";
  import { measuredHeights } from "./layout.svelte";
  import NoteNode from "./NoteNode.svelte";

  const observeAutoHeight: Action<HTMLElement, string> = (element, initialId) => {
    let noteId = initialId;

    const updateMeasuredHeight = () => {
      const note = board.notes[noteId];
      if (!note || note.height !== null) return;

      const height = element.offsetHeight / PX_PER_UNIT;
      if (Number.isFinite(height) && height > 0 && measuredHeights[noteId] !== height) {
        measuredHeights[noteId] = height;
      }
    };

    const observer = new ResizeObserver(updateMeasuredHeight);
    observer.observe(element);

    return {
      update(nextId) {
        if (nextId === noteId) return;
        delete measuredHeights[noteId];
        noteId = nextId;
        observer.disconnect();
        observer.observe(element);
      },
      destroy() {
        observer.disconnect();
        delete measuredHeights[noteId];
      },
    };
  };

  const worldTransform = $derived(
    `translate3d(${viewport.width / 2}px, ${viewport.height / 2}px, 0) ` +
      `scale(${camera.zoom}) ` +
      `translate3d(${-camera.x * PX_PER_UNIT}px, ${-camera.y * PX_PER_UNIT}px, 0)`,
  );
</script>

<div class="notes-world" style:transform={worldTransform}>
  {#each board.order as noteId (noteId)}
    {@const note = board.notes[noteId]}
    {#if note}
      <NoteNode {note} measureHeight={observeAutoHeight} />
    {/if}
  {/each}
</div>

<style>
  .notes-world {
    position: absolute;
    inset: 0;
    overflow: visible;
    transform-origin: 0 0;
    pointer-events: none;
    will-change: transform;
  }
</style>
