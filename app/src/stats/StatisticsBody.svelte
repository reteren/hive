<script lang="ts">
  import { board } from "../model/board.svelte";
  import type { Note } from "../model/note";
  import ScopePicker from "../scope/ScopePicker.svelte";
  import { resolveScope, scopeForNote } from "../scope/scope.svelte";
  import { summarizeTextStatistics } from "./statistics";

  let { note }: { note: Note } = $props();
  let summary = $derived.by(() => {
    const selectedScope = scopeForNote(note);
    return summarizeTextStatistics(resolveScope(selectedScope), board.notes);
  });
</script>

<div class="statistics-body">
  <ScopePicker {note} />
  <div class="statistics-grid" role="status" aria-live="polite" aria-label="Text statistics">
    <div><span>Words</span><strong>{summary.words}</strong></div>
    <div><span>Characters</span><strong>{summary.characters}</strong></div>
    <div><span>Lines</span><strong>{summary.lines}</strong></div>
  </div>
  <p class="statistics-note">Text notes only; calculators and tierlists are excluded.</p>
</div>

<style>
  .statistics-body {
    display: grid;
    gap: 9px;
    min-width: 0;
  }

  .statistics-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 4px;
    text-align: center;
  }

  .statistics-grid > div {
    display: grid;
    gap: 3px;
    min-width: 0;
    padding: 6px 2px;
    background: #202020;
    border: 1px solid #3e3e3e;
    border-radius: 3px;
  }

  .statistics-grid span {
    overflow: hidden;
    color: var(--text-dim);
    font-size: 9px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .statistics-grid strong {
    color: var(--text);
    font-size: 14px;
    font-variant-numeric: tabular-nums;
  }

  .statistics-note {
    margin: 0;
    color: var(--text-dim);
    font-size: 9px;
    line-height: 1.3;
  }
</style>
