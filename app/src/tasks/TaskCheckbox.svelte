<!-- Task completion checkbox in the note header (R3.1); renders nothing for non-task notes. -->
<script lang="ts">
  import type { Note } from "../model/note";
  import { toggleTaskCompletion } from "./taskActions.svelte";

  let { note }: { note: Note } = $props();

  function toggle(): void {
    toggleTaskCompletion(note.id);
  }
</script>

{#if note.task}
  <span class="task-control">
    <button
      class="task-checkbox"
      data-selection-ignore
      class:done={note.task.done}
      type="button"
      role="checkbox"
      aria-checked={note.task.done}
      aria-label={`${note.task.done ? "Reopen" : "Complete"} ${note.name}`}
      title={`${note.task.done ? "Reopen" : "Complete"} ${note.name}`}
      onclick={toggle}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="6.2" />
        {#if note.task.done}<path d="m4.7 8.1 2.1 2.1 4.5-4.6" />{/if}
      </svg>
    </button>
  </span>
{/if}

<style>
  .task-control {
    position: relative;
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
  }

  .task-checkbox {
    display: grid;
    width: 17px;
    height: 17px;
    flex: 0 0 auto;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: #dedede;
    cursor: pointer;
  }

  .task-checkbox svg {
    display: block;
    width: 15px;
    height: 15px;
    overflow: visible;
  }

  .task-checkbox circle {
    fill: transparent;
    stroke: #999;
    stroke-width: 1.35;
  }

  .task-checkbox path {
    fill: none;
    stroke: #171717;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
  }

  .task-checkbox.done circle {
    fill: #82bd88;
    stroke: #a3d5a8;
  }

  .task-checkbox:hover circle {
    stroke: #c1c1c1;
  }

  .task-checkbox:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

</style>
