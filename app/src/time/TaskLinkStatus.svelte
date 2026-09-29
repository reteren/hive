<script lang="ts">
  import { links } from "../model/links.svelte";
  import { board } from "../model/board.svelte";
  import { linkedTaskCompletionForTime } from "./taskLink";

  let { noteId }: { noteId: string } = $props();
  let tasks = $derived(linkedTaskCompletionForTime(noteId, Object.values(links.byId), board.notes));
</script>

{#if tasks.total > 0}
  <p class="task-link-status" data-time-task-mode="stop">{tasks.total === 1 ? "Stops when the task is done" : "Stops when all linked tasks are done"}</p>
{/if}

<style>
  .task-link-status { margin: 0; padding-top: 5px; color: #a2b7a1; border-top: 1px solid #3c403e; font-size: 9px; }
</style>
