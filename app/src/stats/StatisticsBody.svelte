<script lang="ts">
  import { board } from "../model/board.svelte";
  import type { Note } from "../model/note";
  import ScopePicker from "../scope/ScopePicker.svelte";
  import { resolveScope, scopeForNote } from "../scope/scope.svelte";
  import { listViewForStats } from "./linkedList.svelte";
  import { tierlistViewForStats } from "./linkedTierlist.svelte";
  import { summarizeTextStatistics } from "./statistics";

  let { note }: { note: Note } = $props();
  let listView = $derived(listViewForStats(note.id));
  let tierlistView = $derived(tierlistViewForStats(note.id));
  let summary = $derived.by(() => {
    const selectedScope = scopeForNote(note);
    return summarizeTextStatistics(resolveScope(selectedScope), board.notes);
  });
</script>

<div class="statistics-body" data-stats-view={listView ? "list" : tierlistView ? "tierlist" : "text"}>
  {#if listView}
    <div class="tierlist-lock" data-stats-list-lock title="Remove the link to change">Linked to {listView.list.name}</div>
    <div class="statistics-list-rows" role="status" aria-live="polite" aria-label={`Statistics for ${listView.list.name}`}>
      {#each listView.rows as row (row.item.id)}
        <div class="statistics-list-row" data-stats-list-row={row.item.id}>{row.text}</div>
      {/each}
    </div>
  {:else if tierlistView}
    <div class="tierlist-lock" data-stats-tierlist-lock title="Remove the link to change">Linked to {tierlistView.tierlist.name}</div>
    <div class="tierlist-summary" role="status" aria-live="polite" aria-label={`Tierlist statistics for ${tierlistView.tierlist.name}`}>
      <strong class="tierlist-total" data-stats-tierlist-total>{tierlistView.summary.total} {tierlistView.summary.total === 1 ? "item" : "items"} total</strong>
      <div class="tierlist-rows">
        {#each tierlistView.summary.rows as row (row.id)}
          <div class="tierlist-row" data-stats-tier-row={row.id}>
            <span class="tierlist-swatch" style:background={row.color} aria-hidden="true"></span>
            <span class="tierlist-name">{row.name}</span>
            <strong class="tierlist-count">{row.count}</strong>
          </div>
        {/each}
      </div>
    </div>
  {:else}
    <ScopePicker {note} />
    <div class="statistics-grid" role="status" aria-live="polite" aria-label="Text statistics">
      <div><span>Words</span><strong>{summary.words}</strong></div>
      <div><span>Characters</span><strong>{summary.characters}</strong></div>
      <div><span>Lines</span><strong>{summary.lines}</strong></div>
    </div>
  {/if}
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
    user-select: none;
  }

  .statistics-grid strong {
    color: var(--text);
    font-size: 14px;
    font-variant-numeric: tabular-nums;
  }

  .tierlist-lock {
    overflow: hidden;
    color: var(--text-dim);
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .statistics-list-rows {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .statistics-list-row {
    overflow-wrap: anywhere;
    padding: 4px 6px;
    border: 1px solid #3e3e3e;
    border-radius: 3px;
    background: #202020;
    color: var(--text);
    font-size: 10px;
    line-height: 1.35;
  }

  .tierlist-summary {
    display: grid;
    gap: 6px;
  }

  .tierlist-total {
    color: var(--text);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .tierlist-rows { display: grid; gap: 3px; }
  .tierlist-row {
    display: grid;
    min-width: 0;
    grid-template-columns: 12px minmax(0, 1fr) auto;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border: 1px solid #3e3e3e;
    border-radius: 3px;
    background: #202020;
    font-size: 11px;
  }
  .tierlist-swatch { width: 10px; height: 10px; border-radius: 2px; }
  .tierlist-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tierlist-count { font-variant-numeric: tabular-nums; }
</style>
