<script lang="ts">
  import type { Note } from "../model/note";
  import { goalState } from "./goal";

  let { note }: { note: Note } = $props();
  let state = $derived(goalState(note.id));
</script>

<div
  class="goal-summary"
  data-gold={state.gold ? "true" : "false"}
  role="status"
  aria-live="polite"
  aria-label={state.connected > 0
    ? `${state.done} of ${state.connected} connected tasks done${state.subtasks > 0 ? `; ${state.doneSubtasks} of ${state.subtasks} subtasks done` : ""}`
    : "No connected tasks"}
>
  {#if state.connected === 0}
    <span>No connected tasks</span>
  {:else}
    <div class="goal-row">
      <strong>{state.done} / {state.connected}</strong>
      <span>{state.connected === 1 ? "task done" : "tasks done"}</span>
    </div>
    {#if state.subtasks > 0}
      <div class="goal-row goal-subtasks">
        <strong>{state.doneSubtasks} / {state.subtasks}</strong>
        <span>subtasks</span>
      </div>
    {/if}
  {/if}
</div>

<style>
  .goal-summary {
    display: grid;
    min-height: 36px;
    align-content: center;
    justify-items: center;
    gap: 3px;
    color: var(--text-dim);
    font-size: 11px;
    line-height: 1.3;
    text-align: center;
  }

  .goal-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
  }

  .goal-summary strong {
    color: #e8c85e;
    font-size: 14px;
    font-variant-numeric: tabular-nums;
  }

  .goal-subtasks {
    font-size: 10px;
  }

  .goal-subtasks strong {
    font-size: 12px;
  }
</style>
