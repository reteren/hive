<script lang="ts">
  import { tick } from "svelte";
  import type { Action } from "svelte/action";
  import type { Note } from "../model/note";
  import { updateNote } from "../model/board.svelte";
  import { execute } from "../history/history.svelte";
  import { board } from "../model/board.svelte";
  import { editing } from "./editing.svelte";
  import { MIN_NOTE_HEIGHT } from "./layout.svelte";
  import { PX_PER_UNIT } from "../board/cameraMath";
  import { uniqueName } from "./naming";
  import NoteBody from "../editor/NoteBody.svelte";
  import { startNoteEditing } from "../editor/editorSession";
  import { tool } from "../tools/tool.svelte";

  let { note, measureHeight }: { note: Note; measureHeight: Action<HTMLElement, string> } = $props();
  let renaming = $state(false);
  let draftName = $state("");
  let renameInput = $state<HTMLInputElement>();

  function beginRename(): void {
    draftName = note.name;
    editing.noteId = null;
    renaming = true;
    void tick().then(() => {
      renameInput?.focus();
      renameInput?.select();
    });
  }

  function startRename(event: MouseEvent): void {
    if (event.target instanceof Element && event.target.closest("input")) return;

    event.preventDefault();
    event.stopPropagation();
    beginRename();
  }

  function handleRenameKeydown(event: KeyboardEvent): void {
    if (event.code === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      commitRename();
    } else if (event.code === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelRename();
    }
  }

  function handleHeaderKeydown(event: KeyboardEvent): void {
    if (event.target !== event.currentTarget || !["Enter", "Space"].includes(event.code)) return;

    event.preventDefault();
    beginRename();
  }

  function commitRename(): void {
    if (!renaming) return;

    const existing = Object.values(board.notes)
      .filter((other) => other.id !== note.id)
      .map((other) => other.name);
    const nextName = uniqueName(draftName, existing);
    const previousName = note.name;
    renaming = false;

    if (nextName === previousName) return;

    execute({
      label: "Rename",
      target: nextName,
      do: () => updateNote(note.id, { name: nextName }),
      undo: () => updateNote(note.id, { name: previousName }),
    });
  }

  function cancelRename(): void {
    draftName = note.name;
    renaming = false;
  }

  function beginEditingFromDoubleClick(event: MouseEvent): void {
    if (editing.noteId === note.id || !(event.target instanceof Element)) return;
    if (event.target.closest("[data-note-header], [data-text-link], input, button")) return;
    tool.active = "select";
    startNoteEditing(note.id, { x: event.clientX, y: event.clientY });
  }
</script>

<article
  class="note-card"
  data-note-id={note.id}
  data-editing={editing.noteId === note.id ? "true" : "false"}
  style:left={`${note.x * PX_PER_UNIT}px`}
  style:top={`${note.y * PX_PER_UNIT}px`}
  style:width={`${note.width * PX_PER_UNIT}px`}
  style:height={note.height === null ? "auto" : `${note.height * PX_PER_UNIT}px`}
  style:min-height={note.height === null ? `${MIN_NOTE_HEIGHT * PX_PER_UNIT}px` : "0px"}
  use:measureHeight={note.id}
  ondblclick={beginEditingFromDoubleClick}
>
  <header
    class="note-header"
    data-note-header
    role="button"
    tabindex="0"
    ondblclick={startRename}
    onkeydown={handleHeaderKeydown}
  >
    {#if renaming}
      <input
        bind:this={renameInput}
        bind:value={draftName}
        class="rename-input"
        aria-label="Note name"
        onkeydown={handleRenameKeydown}
        onblur={commitRename}
      />
    {:else}
      <span class="note-name">{note.name}</span>
    {/if}
  </header>
  <div
    class="note-content"
    data-note-body
  >
    <NoteBody {note} />
  </div>
</article>

<style>
  .note-card {
    position: absolute;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: var(--text);
    background: var(--bg-panel-raised);
    border: 1px solid #414141;
    border-radius: 5px;
    box-shadow: 0 3px 12px rgb(0 0 0 / 28%);
    pointer-events: auto;
    user-select: text;
  }

  .note-header {
    display: flex;
    min-height: 28px;
    align-items: center;
    padding: 0 8px;
    color: #e6e6e6;
    background: #343434;
    border-bottom: 1px solid #454545;
    font-size: 11px;
    font-weight: 600;
    user-select: none;
  }

  .note-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rename-input {
    width: 100%;
    min-width: 0;
    padding: 2px 3px;
    color: var(--text);
    background: #202020;
    border: 1px solid var(--accent);
    border-radius: 2px;
    font: inherit;
    user-select: text;
  }

  .note-content {
    min-height: 20px;
    flex: 1 0 auto;
    padding: 7px 8px 9px;
    overflow-wrap: anywhere;
    user-select: text;
  }

  .note-content :global(.note-body) {
    min-height: 1em;
  }
</style>
