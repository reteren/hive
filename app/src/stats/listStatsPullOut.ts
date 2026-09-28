import type { Action } from "svelte/action";
import { camera } from "../board/camera.svelte";
import { PX_PER_UNIT, type Point } from "../board/cameraMath";
import { board } from "../model/board.svelte";
import { links } from "../model/links.svelte";
import { R5_BASE_WIDTHS } from "../model/note";
import { noteBounds } from "../notes/layout.svelte";
import { worldPointFromClient } from "../modules/moduleActions.svelte";
import { formatLinkedListRow, statisticsForListRow } from "./listStatistics";
import { extractStatisticsFromList } from "./listStatsActions.svelte";

export function statisticsPullOutMoved(start: Point, point: Point): boolean {
  return Math.hypot(point.x - start.x, point.y - start.y) >= 6;
}

/** The attached panel stays in place until release; cancellation never mutates the board. */
export const pullOutListStatistics: Action<HTMLElement, string> = (element, listId) => {
  let gesture: { pointerId: number; start: Point; moved: boolean } | null = null;
  let ghost: HTMLDivElement | null = null;
  let previousUserSelect: string | null = null;

  const cleanup = () => {
    const active = gesture;
    gesture = null;
    ghost?.remove(); ghost = null;
    if (previousUserSelect !== null) {
      document.body.style.userSelect = previousUserSelect;
      previousUserSelect = null;
    }
    if (active && element.hasPointerCapture(active.pointerId)) element.releasePointerCapture(active.pointerId);
  };
  const begin = (event: PointerEvent) => {
    if (event.button !== 0 || gesture || board.notes[listId]?.listStats !== true) return;
    event.preventDefault(); event.stopPropagation();
    gesture = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, moved: false };
    element.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const point = { x: event.clientX, y: event.clientY };
    if (!gesture.moved && !statisticsPullOutMoved(gesture.start, point)) return;
    gesture.moved = true;
    event.preventDefault(); event.stopPropagation();
    if (!ghost) {
      previousUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      ghost = document.createElement("div");
      ghost.dataset.listStatsDragPreview = listId;
      ghost.setAttribute("aria-hidden", "true");
      ghost.inert = true;
      Object.assign(ghost.style, { position: "fixed", zIndex: "2147483000", pointerEvents: "none", opacity: "0.5",
        boxSizing: "border-box", width: `${R5_BASE_WIDTHS.stats * PX_PER_UNIT}px`, padding: "7px", border: "1px solid #53565e",
        borderRadius: "5px", background: "var(--note-body, #24262b)", color: "var(--text, #dedfe2)", fontSize: "10px", transformOrigin: "top left" });
      const header = document.createElement("strong");
      header.textContent = "Statistics";
      Object.assign(header.style, { display: "block", marginBottom: "7px", fontSize: "11px" });
      ghost.append(header);
      for (const item of board.notes[listId]?.listItems ?? []) {
        const row = document.createElement("div");
        row.textContent = formatLinkedListRow(statisticsForListRow(listId, item, board.notes, links.byId));
        Object.assign(row.style, { minHeight: "26px", borderTop: "1px solid #41444a", padding: "4px 0" });
        ghost.append(row);
      }
      document.body.append(ghost);
    }
    ghost.style.transform = `scale(${camera.zoom})`;
    ghost.style.left = `${point.x - R5_BASE_WIDTHS.stats * PX_PER_UNIT * camera.zoom / 2}px`;
    ghost.style.top = `${point.y - ghost.offsetHeight * camera.zoom / 2}px`;
  };
  const finish = (event: PointerEvent) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const moved = gesture.moved;
    const point = worldPointFromClient(event.clientX, event.clientY);
    const list = board.notes[listId];
    const bounds = list ? noteBounds(list) : null;
    const inside = point && bounds && point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height;
    cleanup();
    event.stopPropagation();
    if (!moved || !point || inside) return;
    event.preventDefault();
    extractStatisticsFromList(listId, point);
  };
  const cancel = (event: PointerEvent) => { if (gesture?.pointerId === event.pointerId) cleanup(); };
  const key = (event: KeyboardEvent) => {
    if (event.code !== "Escape" || !gesture) return;
    event.preventDefault(); event.stopImmediatePropagation(); cleanup();
  };
  element.addEventListener("pointerdown", begin);
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerup", finish);
  element.addEventListener("pointercancel", cancel);
  element.addEventListener("lostpointercapture", cancel);
  window.addEventListener("keydown", key, true);
  window.addEventListener("blur", cleanup);
  return {
    update(next) { if (listId !== next) cleanup(); listId = next; },
    destroy() {
      cleanup();
      element.removeEventListener("pointerdown", begin);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", finish);
      element.removeEventListener("pointercancel", cancel);
      element.removeEventListener("lostpointercapture", cancel);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", cleanup);
    },
  };
};
