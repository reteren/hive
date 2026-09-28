<script lang="ts">
  import type { Action } from "svelte/action";
  import type { Note } from "../model/note";
  import { R5_BASE_WIDTHS } from "../model/note";
  import { PX_PER_UNIT } from "../board/cameraMath";
  import { noteBounds } from "../notes/layout.svelte";
  import { extractStatisticsFromList } from "./listStatsActions.svelte";
  import { fittedListStatisticsWidth, listExtensionGeometry, type ExtensionGeometry } from "./listStatsLayout";
  import { listStatisticsMeasurements } from "./listStatsMeasurements.svelte";
  import { formatListRowExtension, formatListStatisticsTotal, type ListRowStatistics, type ListStatisticsTotal } from "./listStatistics";
  import { pullOutListStatistics } from "./listStatsPullOut";

  let { list, bodyElement, rowsElement, footerElement, statistics, total }: {
    list: Note; bodyElement: HTMLElement; rowsElement: HTMLElement; footerElement: HTMLElement;
    statistics: readonly (ListRowStatistics | null)[]; total: ListStatisticsTotal;
  } = $props();
  let labels = $derived([...statistics.flatMap((row) => row ? [formatListRowExtension(row)] : []), formatListStatisticsTotal(total)]);
  let geometry = $state<ExtensionGeometry>({ left: 0, top: 0, height: 28, cellLeft: 0 });
  const measure: Action<HTMLElement> = (element) => {
    const article = bodyElement.closest<HTMLElement>(".note-card");
    const naturalContent = element.querySelector<HTMLElement>("[data-list-stats-measure]");
    if (!article || !naturalContent) return;
    const update = () => {
      const header = article.querySelector<HTMLElement>(".note-header");
      const frame = article.querySelector<HTMLElement>(".note-frame");
      if (!frame) return;
      const articleRect = article.getBoundingClientRect();
      const bodyRect = bodyElement.getBoundingClientRect();
      const rowsRect = rowsElement.getBoundingClientRect();
      const headerRect = (header ?? frame).getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      const footerRect = footerElement.getBoundingClientRect();
      const scale = articleRect.width / Math.max(article.offsetWidth, 1);
      const width = fittedListStatisticsWidth(naturalContent.offsetWidth, PX_PER_UNIT);
      if (listStatisticsMeasurements[list.id] !== width) listStatisticsMeasurements[list.id] = width;
      const next = listExtensionGeometry((frameRect.right - articleRect.left) / scale,
        (bodyRect.left - articleRect.left) / scale, (bodyRect.top - articleRect.top) / scale,
        (rowsRect.left - articleRect.left) / scale, (footerRect.bottom - articleRect.top) / scale,
        (headerRect.top - articleRect.top) / scale);
      if (JSON.stringify(geometry) !== JSON.stringify(next)) geometry = next;
      bodyElement.style.setProperty("--list-statistics-cell-left", `${next.cellLeft}px`);
    };
    const observer = new ResizeObserver(update);
    observer.observe(article); observer.observe(rowsElement); observer.observe(footerElement); observer.observe(naturalContent);
    const mutations = new MutationObserver(update);
    mutations.observe(rowsElement, { childList: true, subtree: true, characterData: true });
    mutations.observe(footerElement, { childList: true, subtree: true, characterData: true });
    update();
    return { destroy() {
      observer.disconnect(); mutations.disconnect(); bodyElement.style.removeProperty("--list-statistics-cell-left");
      delete listStatisticsMeasurements[list.id];
    } };
  };
  function extractByKeyboard(event: KeyboardEvent): void {
    if (event.code !== "Enter" && event.code !== "Space") return;
    event.preventDefault(); event.stopPropagation();
    const bounds = noteBounds(list);
    extractStatisticsFromList(list.id, { x: bounds.x + bounds.width + 5 + R5_BASE_WIDTHS.stats / 2, y: bounds.y + bounds.height / 2 });
  }
</script>

<section class="list-statistics-extension" data-list-stats-extension={list.id} data-selection-ignore
  role="group" aria-label={`Statistics attached to ${list.name}`}
  style:left={`${geometry.left}px`} style:top={`${geometry.top}px`} style:height={`${geometry.height}px`}
  style:width="var(--list-statistics-width)"
  use:measure use:pullOutListStatistics={list.id}>
  {#if !list.headerHidden}<button class="list-statistics-header" type="button" data-list-stats-header
    aria-label="Drag Statistics out of this List" title="Drag out to restore a linked Statistics node"
    onkeydown={extractByKeyboard}>Statistics</button>{/if}
  <div class="list-statistics-measure" data-list-stats-measure aria-hidden="true">
    {#if !list.headerHidden}<span class="measure-header">Statistics</span>{/if}
    {#each labels as label}<span>{label}</span>{/each}
  </div>
</section>

<style>
  .list-statistics-extension {
    position: absolute;
    z-index: 1;
    box-sizing: border-box;
    min-height: 28px;
    border-left: 1px solid #53565e;
    border-bottom: 1px solid #41444a;
    border-radius: 0 4px 4px 0;
    background: var(--note-body);
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .list-statistics-extension:active { cursor: grabbing; }
  .list-statistics-header {
    display: block;
    box-sizing: border-box;
    width: 100%;
    min-height: 28px;
    padding: 0 9px;
    border: 0;
    border-bottom: 1px solid #454545;
    color: var(--text);
    background: var(--note-frame);
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    text-align: left;
    cursor: inherit;
  }
  .list-statistics-header:focus-visible { outline: 1px solid var(--accent); outline-offset: -2px; }
  .list-statistics-measure {
    position: absolute; top: 0; left: 0;
    display: grid; width: max-content;
    visibility: hidden; pointer-events: none;
    font-size: 10px; font-variant-numeric: tabular-nums; white-space: nowrap;
  }
  .list-statistics-measure span { padding: 0 9px; }
  .list-statistics-measure .measure-header { font-size: 11px; font-weight: 600; }
</style>
