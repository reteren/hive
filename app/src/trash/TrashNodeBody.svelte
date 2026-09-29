<script lang="ts">
  import type { Note } from "../model/note";
  import TrashList from "./TrashList.svelte";

  let { note }: { note: Note } = $props();
</script>

<div class="trash-node-body" data-trash-node-body aria-label={`Trash contents for ${note.name}`}>
  <TrashList compact />
</div>

<style>
  .trash-node-body,
  .trash-node-body :global(*) {
    -webkit-user-select: none;
    user-select: none;
  }

  .trash-node-body :global(input:not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="reset"])),
  .trash-node-body :global(textarea),
  .trash-node-body :global([contenteditable="true"]) {
    -webkit-user-select: text;
    user-select: text;
  }

  .trash-node-body {
    display: flex;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    padding: 2px;
    overflow: hidden;
  }

  .trash-node-body :global(.trash-list) {
    width: 100%;
    height: 100%;
    min-height: 0;
  }

  .trash-node-body :global(.compact .trash-entries) {
    max-height: none;
  }

  :global(.note-card[data-kind="trash"] .note-content) {
    display: flex;
    min-height: 0;
    padding: 3px 5px;
    overflow: hidden;
  }
</style>
