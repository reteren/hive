<script lang="ts">
  import type { Note } from "../model/note";
  import TrashList from "./TrashList.svelte";

  let { note }: { note: Note } = $props();
</script>

<div class="trash-node-body" data-trash-node-body aria-label={`Trash contents for ${note.name}`}>
  <TrashList compact />
</div>

<style>
  .trash-node-body {
    min-width: 0;
    padding: 2px;
  }
</style>
