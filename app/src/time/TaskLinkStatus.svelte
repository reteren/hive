<script lang="ts">
  import { links } from "../model/links.svelte";
  import { board } from "../model/board.svelte";
  import { hasLinkedTaskForTime } from "./taskLink";

  let { noteId }: { noteId: string } = $props();
  let hasLinkedTask = $derived(hasLinkedTaskForTime(noteId, Object.values(links.byId), board.notes));
</script>

{#if hasLinkedTask}
  <p class="task-link-status" data-time-task-mode="stop">Stops when the task is done</p>
{/if}

<style>
  .task-link-status { margin: 0; padding-top: 5px; color: #a2b7a1; border-top: 1px solid #3c403e; font-size: 9px; }
</style>
