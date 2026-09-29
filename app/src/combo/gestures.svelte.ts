import type { Action } from "svelte/action";
import { extractComboPart, worldPointFromClient } from "./actions.svelte";
import type { ComboSection } from "./logic";

export interface ComboPulloutOptions {
  noteId: string;
  section: ComboSection;
}

export const comboPullout: Action<HTMLElement, ComboPulloutOptions> = (node, initial) => {
  let options = initial;
  let gesture: { pointerId: number; x: number; y: number; dragging: boolean; preview: HTMLDivElement | null } | null = null;

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !(event.target instanceof Element) ||
      event.target.closest("button, input, textarea, select, label, [contenteditable='true']")) return;
    gesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, dragging: false, preview: null };
    event.stopPropagation();
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerCancel, true);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!gesture.dragging && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 4) return;
    gesture.dragging = true;
    event.preventDefault();
    event.stopPropagation();
    if (!gesture.preview) {
      gesture.preview = document.createElement("div");
      gesture.preview.textContent = options.section === "message" ? "Message" : "Time";
      Object.assign(gesture.preview.style, {
        position: "fixed", zIndex: "1000", padding: "4px 7px", border: "1px solid #806c3b",
        borderRadius: "3px", background: "#2b2923", color: "var(--text)", fontSize: "10px", pointerEvents: "none",
      });
      document.body.append(gesture.preview);
    }
    gesture.preview.style.left = `${event.clientX + 10}px`;
    gesture.preview.style.top = `${event.clientY + 10}px`;
  }

  function onPointerUp(event: PointerEvent): void {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const completed = gesture;
    clearGesture();
    if (!completed.dragging) return;
    event.preventDefault();
    event.stopPropagation();
    const point = worldPointFromClient(event.clientX, event.clientY);
    if (point) extractComboPart(options.noteId, options.section, point);
  }

  function onPointerCancel(event: PointerEvent): void {
    if (gesture?.pointerId === event.pointerId) clearGesture();
  }

  function clearGesture(): void {
    gesture?.preview?.remove();
    gesture = null;
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("pointercancel", onPointerCancel, true);
  }

  node.addEventListener("pointerdown", onPointerDown);
  return {
    update(next) { options = next; },
    destroy() {
      clearGesture();
      node.removeEventListener("pointerdown", onPointerDown);
    },
  };
};
