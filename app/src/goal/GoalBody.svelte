<script lang="ts">
  import type { Note } from "../model/note";
  import { goalState, visibleGoalRows } from "./goal";

  let { note }: { note: Note } = $props();
  let state = $derived(goalState(note.id));
  let rows = $derived(visibleGoalRows(state));
</script>

<div
  class="goal-summary"
  data-gold={state.gold ? "true" : "false"}
  data-row-count={rows.length}
  role="status"
  aria-live="polite"
  aria-label={rows.length > 0
    ? rows.map((row) => `${row.done} of ${row.total} ${row.label}`).join("; ")
    : "No connected tasks or goals"}
>
  {#if rows.length === 0}
    <span>No connected tasks or goals</span>
  {:else}
    {#each rows as row (row.kind)}
      <div class="goal-row" class:goal-secondary={row.kind !== "tasks"} data-goal-row={row.kind}>
        <strong>{row.done} / {row.total}</strong>
        <span>{row.label}</span>
      </div>
    {/each}
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

  .goal-summary[data-row-count="3"] {
    min-height: 58px;
  }

  .goal-summary strong {
    color: #e8c85e;
    font-size: 14px;
    font-variant-numeric: tabular-nums;
  }

  .goal-secondary {
    font-size: 10px;
  }

  .goal-secondary strong {
    font-size: 12px;
  }
</style>
