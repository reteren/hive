<script module lang="ts">
  import { execute } from "../history/history.svelte";
  import { board, updateNote } from "../model/board.svelte";
  import type { Note as NoteModel } from "../model/note";
  import { selection } from "../selection/selection.svelte";
  import { registerCommand } from "../commands/registry.svelte";

  function canLockWidth(note: NoteModel | undefined): note is NoteModel {
    return Boolean(note && (note.type === "note" || note.type === "pro" || note.type === "con"));
  }

  function toggleWidthLock(noteId: string | null): void {
    const note = noteId ? board.notes[noteId] : undefined;
    if (!canLockWidth(note)) return;
    const before = note.widthLocked;
    const after = !before;
    execute({
      label: after ? "Lock note width" : "Unlock note width",
      target: note.name,
      do: () => updateNote(note.id, { widthLocked: after }),
      undo: () => updateNote(note.id, { widthLocked: before }),
    });
  }

  registerCommand({
    id: "notes.toggleWidthLock",
    label: "Toggle Note Width Lock",
    keys: [],
    run: () => toggleWidthLock(selection.primaryId),
    isActive: () => Boolean(selection.primaryId && board.notes[selection.primaryId]?.widthLocked),
  });
</script>

<script lang="ts">
  import type { Note } from "../model/note";
  let { note }: { note: Note } = $props();

  function toggle(): void {
    toggleWidthLock(note.id);
  }
</script>

{#if note.type === "note" || note.type === "pro" || note.type === "con"}
  <button
    class="node-width-lock"
    data-selection-ignore
    type="button"
    aria-label={`${note.widthLocked ? "Unlock" : "Lock"} ${note.name} width`}
    aria-pressed={note.widthLocked ?? false}
    title={note.widthLocked ? "Unlock note width" : "Lock note width"}
    onclick={toggle}
  >
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {#if note.widthLocked}
        <rect x="3.2" y="7" width="9.6" height="7" rx="1.3" />
        <path d="M5.2 7V4.8a2.8 2.8 0 0 1 5.6 0V7" />
      {:else}
        <rect x="3.2" y="7" width="9.6" height="7" rx="1.3" />
        <path d="M5.2 7V4.8a2.8 2.8 0 0 1 5.2-1.4" />
      {/if}
      <circle cx="8" cy="10.5" r=".7" />
    </svg>
  </button>
{/if}

<style>
  .node-width-lock {
    display: grid;
    width: 19px;
    height: 20px;
    flex: 0 0 auto;
    place-items: center;
    margin-left: auto;
    padding: 0;
    border: 0;
    border-radius: 3px;
    color: var(--text-dim);
    background: transparent;
    cursor: pointer;
  }

  .node-width-lock:hover,
  .node-width-lock[aria-pressed="true"] { color: var(--accent); background: #ffffff0d; }
  .node-width-lock:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .node-width-lock svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.35; stroke-linecap: round; stroke-linejoin: round; }
  .node-width-lock circle { fill: currentColor; stroke: none; }
</style>
