<script lang="ts">
  import { NOTE_HEADER_HEIGHT_UNITS, normalizeNoteScale, type Note } from "../model/note";
  import { PX_PER_UNIT } from "../board/cameraMath";
  import { noteBounds } from "./layout.svelte";
  import { noteColorStyle } from "./noteColorLogic";
  import { pinNote, type LodTier } from "../board/visibility.svelte";
  import { tick } from "svelte";
  import { t } from "../i18n/i18n.svelte";

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

  /**
   * Double-click on a shell: pin the note so its full NoteNode replaces the shell under the cursor, then
   * hand it the same double-click — editing text, renaming the header and every per-kind exclusion keep
   * working exactly as at full zoom. The pin lasts until the next press outside that card.
   */
  async function openFromShell(event: MouseEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const { clientX, clientY } = event;
    const noteId = note.id;
    const release = pinNote(noteId, "shell-double-click");
    await tick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const target = document.elementFromPoint(clientX, clientY);
    const card = target?.closest<HTMLElement>(".note-card[data-note-id]");
    if (!target || card?.dataset.noteId !== noteId || card.classList.contains("note-shell")) {
      release();
      return;
    }
    target.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX, clientY, view: window }));
    const releaseOnOutsidePress = (press: PointerEvent) => {
      const inside = press.target instanceof Element && press.target.closest(`[data-note-id="${CSS.escape(noteId)}"]`);
      if (inside) return;
      window.removeEventListener("pointerdown", releaseOnOutsidePress, true);
      release();
    };
    window.addEventListener("pointerdown", releaseOnOutsidePress, true);
  }
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
  style:--note-header-text-done={paint["--note-header-text-done"]}
  style:transform={`translate(${note.x * PX_PER_UNIT}px, ${note.y * PX_PER_UNIT}px)${scale === 1 ? "" : ` scale(${scale})`}`}
  style:width={`${width * PX_PER_UNIT}px`}
  style:height={`${height * PX_PER_UNIT}px`}
  style:--shell-header={`${(note.headerHidden ? 0 : NOTE_HEADER_HEIGHT_UNITS) * PX_PER_UNIT}px`}
  role="group"
  aria-label={note.name}
  ondblclick={openFromShell}
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

  /* A Map body is a dark minimap, not the grey --note-body its kind CSS sets for the frame. */
  .note-shell[data-kind="map"] {
    background: var(--note-frame);
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
