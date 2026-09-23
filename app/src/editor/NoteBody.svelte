<!-- Note body: static Markdown text, and the live editor while the note is being edited (R1.3). -->
<script lang="ts">
  import { editing } from "../notes/editing.svelte";
  import type { Note } from "../model/note";
  import EditorHost from "./EditorHost.svelte";
  import MarkdownPreview from "./MarkdownPreview.svelte";
  import { startNoteEditing } from "./editorSession";

  let { note }: { note: Note } = $props();

  function beginEditing(event: PointerEvent): void {
    startNoteEditing(note.id, { x: event.clientX, y: event.clientY });
  }

  function beginEditingFromKeyboard(event: KeyboardEvent): void {
    if (event.code !== "Space" && event.code !== "Enter") return;
    event.preventDefault();
    const rect = event.currentTarget instanceof HTMLElement
      ? event.currentTarget.getBoundingClientRect()
      : null;
    startNoteEditing(note.id, rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: 0, y: 0 });
  }
</script>

{#if editing.noteId === note.id}
  <div class="note-body" class:fixed-height={note.height !== null}>
    <EditorHost {note} />
  </div>
{:else}
  <div
    class="note-body"
    class:fixed-height={note.height !== null}
    role="button"
    tabindex="0"
    aria-label={`Edit text for ${note.name}`}
    onpointerdown={beginEditing}
    onkeydown={beginEditingFromKeyboard}
  >
    <MarkdownPreview text={note.text} />
  </div>
{/if}

<style>
  .note-body {
    min-width: 0;
    user-select: text;
  }

  .fixed-height {
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .fixed-height :global(.editor-host),
  .fixed-height :global(.cm-editor) {
    height: 100%;
    min-height: 0;
  }

  .fixed-height :global(.cm-scroller) {
    overflow: auto;
  }

  :global(.note-content:has(> .note-body.fixed-height)) {
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }

  .note-body:not(.fixed-height) :global(.cm-editor),
  .note-body:not(.fixed-height) :global(.cm-scroller) {
    height: auto;
    overflow: visible;
  }
</style>
