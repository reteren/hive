<script lang="ts">
  import { NOTE_HEADER_HEIGHT_UNITS, normalizeNoteScale, type Note } from "../model/note";
  import { PX_PER_UNIT } from "../board/cameraMath";
  import { noteBounds } from "./layout.svelte";
  import { noteColorStyle } from "./noteColorLogic";
  import type { LodTier } from "../board/visibility.svelte";

  /**
   * Far-zoom stand-in for NoteNode: the node's box in its colours, with its title at the "simple" tier
   * and nothing inside at the "min" tier. No body component, editor, observers or timers. The whole
   * shell is a move handle (data-note-header), so nodes can still be selected and dragged from afar.
   */
  let { note, tier }: { note: Note; tier: LodTier } = $props();
  let paint = $derived(noteColorStyle(note));
  let scale = $derived(normalizeNoteScale(note.scale));
  // Bounds already hold scale; the card is drawn unscaled and transformed like NoteNode.
  let height = $derived(noteBounds(note).height / scale);
  let width = $derived(noteBounds(note).width / scale);
</script>

<div
  class="note-card note-shell"
  data-note-id={note.id}
  data-kind={note.type}
  data-note-header
  data-lod-shell={tier}
  data-task={note.task ? (note.task.done ? "done" : "open") : undefined}
  data-header-hidden={note.headerHidden ? "true" : undefined}
  style:--note-frame={paint["--note-frame"]}
  style:--note-body={paint["--note-body"]}
  style:--note-header-text={paint["--note-header-text"]}
  style:transform={`translate(${note.x * PX_PER_UNIT}px, ${note.y * PX_PER_UNIT}px)${scale === 1 ? "" : ` scale(${scale})`}`}
  style:width={`${width * PX_PER_UNIT}px`}
  style:height={`${height * PX_PER_UNIT}px`}
  style:--shell-header={`${(note.headerHidden ? 0 : NOTE_HEADER_HEIGHT_UNITS) * PX_PER_UNIT}px`}
>
  {#if tier === "simple" && !note.headerHidden}
    <span class="shell-name">{note.name}</span>
  {/if}
</div>

<style>
  .note-shell {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: top left;
    box-sizing: border-box;
    overflow: hidden;
    contain: strict;
    border-radius: 5px;
    /* Header band in the frame colour, body below it, like a real card without its content. */
    background: linear-gradient(var(--note-frame) 0 var(--shell-header), var(--note-body, #262626) var(--shell-header));
    pointer-events: auto;
    user-select: none;
  }

  .note-shell[data-lod-shell="min"] {
    border-radius: 0;
  }

  .note-shell[data-task="done"] {
    opacity: 0.6;
  }

  .shell-name {
    display: block;
    height: var(--shell-header);
    padding: 0 8px;
    overflow: hidden;
    color: var(--note-header-text, #e6e6e6);
    font-size: 11px;
    font-weight: 600;
    line-height: var(--shell-header);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
