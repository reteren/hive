<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Point } from "../board/cameraMath";
  import { R5_BASE_WIDTHS, type Note } from "../model/note";
  import type { ListItem } from "../model/nodeData";
  import { links } from "../model/links.svelte";
  import { board } from "../model/board.svelte";
  import { extractStatisticsFromList } from "./listStatsActions.svelte";
  import { statisticsForListRow, formatListRowExtension } from "./listStatistics";
  import { worldPointFromClient } from "../modules/moduleActions.svelte";
  import { noteBounds } from "../notes/layout.svelte";

  let { list, item }: { list: Note; item: ListItem } = $props();
  let statistics = $derived(statisticsForListRow(list.id, item, board.notes, links.byId));
  let label = $derived(formatListRowExtension(statistics));

  let gesture: { pointerId: number; startX: number; startY: number; dragging: boolean } | null = null;
  let previousUserSelect: { root: string; body: string } | null = null;

  function beginDrag(event: PointerEvent): void {
    event.stopPropagation();
    if (event.button !== 0 || gesture) return;
    event.preventDefault();
    gesture = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, dragging: false };
    window.addEventListener("pointermove", moveDrag, true);
    window.addEventListener("pointerup", finishDrag, true);
    window.addEventListener("pointercancel", cancelDrag, true);
  }

  function moveDrag(event: PointerEvent): void {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!gesture.dragging && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) >= 6) {
      gesture.dragging = true;
      previousUserSelect = {
        root: document.documentElement.style.userSelect,
        body: document.body.style.userSelect,
      };
      document.documentElement.style.userSelect = "none";
      document.body.style.userSelect = "none";
    }
    if (gesture.dragging) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function finishDrag(event: PointerEvent): void {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const wasDragging = gesture.dragging;
    cleanupDrag();
    if (!wasDragging) return;

    event.preventDefault();
    event.stopPropagation();
    const point = worldPointFromClient(event.clientX, event.clientY);
    if (!point || pointIsInsideList(point)) return;
    extractStatisticsFromList(list.id, point);
  }

  function cancelDrag(event: PointerEvent): void {
    if (gesture?.pointerId === event.pointerId) cleanupDrag();
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.code !== "Enter" && event.code !== "Space") return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = noteBounds(list);
    const point: Point = {
      x: bounds.x + bounds.width + 8 + R5_BASE_WIDTHS.stats / 2,
      y: bounds.y + bounds.height / 2,
    };
    extractStatisticsFromList(list.id, point);
  }

  function pointIsInsideList(point: Point): boolean {
    const bounds = noteBounds(list);
    return point.x >= bounds.x && point.x <= bounds.x + bounds.width &&
      point.y >= bounds.y && point.y <= bounds.y + bounds.height;
  }

  function cleanupDrag(): void {
    gesture = null;
    window.removeEventListener("pointermove", moveDrag, true);
    window.removeEventListener("pointerup", finishDrag, true);
    window.removeEventListener("pointercancel", cancelDrag, true);
    if (previousUserSelect) {
      document.documentElement.style.userSelect = previousUserSelect.root;
      document.body.style.userSelect = previousUserSelect.body;
      previousUserSelect = null;
    }
  }

  onDestroy(cleanupDrag);
</script>

<span
  class="list-stats-extension"
  role="button"
  tabindex="0"
  aria-label={`Statistics: ${label}. Drag out of ${list.name} to restore a Statistics node`}
  title="Drag out to restore a linked Statistics node"
  data-list-stats-extension={list.id}
  data-list-stats-row={item.id}
  onpointerdown={beginDrag}
  onkeydown={handleKeydown}
>{label}</span>

<style>
  .list-stats-extension {
    display: block;
    max-width: 100%;
    overflow: hidden;
    color: var(--text-dim);
    cursor: grab;
    font-size: 9px;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: none;
  }

  .list-stats-extension:focus-visible {
    border-radius: 2px;
    outline: 1px solid var(--focus-ring, #80a9ff);
    outline-offset: 2px;
  }
</style>
