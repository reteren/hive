<script lang="ts">
  import { formatListRowExtension, type ListRowStatistics } from "./listStatistics";
  let { itemId, statistics }: { itemId: string; statistics: ListRowStatistics } = $props();
  let label = $derived(formatListRowExtension(statistics));
</script>

<span class="list-statistics-cell" data-list-stats-row={itemId} title={label} aria-label={`Statistics: ${label}`}>{label}</span>

<style>
  .list-statistics-cell {
    position: absolute;
    z-index: 2;
    top: 0;
    bottom: 0;
    left: var(--list-statistics-cell-left);
    display: flex;
    box-sizing: border-box;
    width: var(--list-statistics-width);
    min-height: 26px;
    align-items: center;
    overflow: hidden;
    padding: 3px 9px;
    color: var(--text-dim);
    border-bottom: 1px solid #41444a;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    pointer-events: none;
    user-select: none;
  }
</style>
