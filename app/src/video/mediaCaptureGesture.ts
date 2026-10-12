import type { Point } from "../board/cameraMath";

interface ActiveGesture {
  pointerId: number;
  start: Point;
  shouldMove(start: Point, current: Point): boolean;
  activate(): void;
}

const active = new Map<number, ActiveGesture>();
let listening = false;

/** Register a media click-versus-board-drag gesture using one shared set of window listeners. */
export function beginMediaCaptureGesture(
  event: PointerEvent,
  shouldMove: ActiveGesture["shouldMove"],
  activate: () => void,
): () => void {
  if (event.button !== 0 || event.isPrimary === false) return () => {};
  const gesture: ActiveGesture = {
    pointerId: event.pointerId,
    start: { x: event.clientX, y: event.clientY },
    shouldMove,
    activate,
  };
  active.set(event.pointerId, gesture);
  attach();
  return () => finish(event.pointerId);
}

function onMove(event: PointerEvent): void {
  const gesture = active.get(event.pointerId);
  if (gesture && gesture.shouldMove(gesture.start, { x: event.clientX, y: event.clientY })) {
    active.delete(event.pointerId);
    detachIfIdle();
  }
}

function onUp(event: PointerEvent): void {
  const gesture = active.get(event.pointerId);
  if (!gesture) return;
  finish(event.pointerId);
  gesture.activate();
}

function onCancel(event: PointerEvent): void {
  finish(event.pointerId);
}

function attach(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onCancel, true);
}

function finish(pointerId: number): void {
  active.delete(pointerId);
  detachIfIdle();
}

function detachIfIdle(): void {
  if (!listening || active.size > 0 || typeof window === "undefined") return;
  listening = false;
  window.removeEventListener("pointermove", onMove, true);
  window.removeEventListener("pointerup", onUp, true);
  window.removeEventListener("pointercancel", onCancel, true);
}
