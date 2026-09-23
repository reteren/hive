<!-- Note body: static Markdown text, and the live editor while the note is being edited (R1.3). -->
<script lang="ts">
  import type { Note } from "../model/note";

  let { note }: { note: Note } = $props();
</script>

<div class="note-body">{note.text}</div>

<style>
  .note-body {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
