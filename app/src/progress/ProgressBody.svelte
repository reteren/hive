<script lang="ts">
  import { board } from "../model/board.svelte";
  import type { Note } from "../model/note";
  import { effectiveImportance } from "../modules/moduleActions.svelte";
  import ScopePicker from "../scope/ScopePicker.svelte";
  import { resolveScope, scopeForNote } from "../scope/scope.svelte";
  import { summarizeProgress } from "./progress";

  let { note }: { note: Note } = $props();
  let summary = $derived.by(() => {
    const selectedScope = scopeForNote(note);
    return summarizeProgress(resolveScope(selectedScope), board.notes, effectiveImportance);
  });
</script>

<div class="progress-body">
  <ScopePicker {note} />
  {#if summary.totalWeight === 0}
    <div class="progress-empty" role="status">—</div>
  {:else}
    <div
      class="progress-meter"
      role="progressbar"
      aria-label="Task progress"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={summary.percent ?? 0}
      aria-valuetext={`${summary.doneWeight} of ${summary.totalWeight} weighted points`}
    >
      <div class="progress-fill" style:width={`${summary.percent ?? 0}%`}></div>
    </div>
    <div class="progress-summary" role="status" aria-live="polite">
      <span>{summary.doneWeight} / {summary.totalWeight} weight</span>
      <strong>{summary.percent}%</strong>
    </div>
  {/if}
</div>

<style>
  .progress-body {
    display: grid;
    gap: 9px;
    min-width: 0;
  }

  .progress-meter {
    height: 8px;
    overflow: hidden;
    background: #171717;
    border: 1px solid #444;
    border-radius: 5px;
  }

  .progress-fill {
    height: 100%;
    background: var(--accent);
    transition: width 120ms ease-out;
  }

  .progress-summary {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    color: var(--text-dim);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .progress-summary strong {
    color: var(--text);
    font-size: 14px;
  }

  .progress-empty {
    color: var(--text-dim);
    text-align: center;
    font-size: 16px;
  }

  @media (prefers-reduced-motion: reduce) {
    .progress-fill {
      transition: none;
    }
  }
</style>
