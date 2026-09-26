import type { Action } from "svelte/action";
import { screenToWorld, worldToScreen, type Camera, type Point, type Size } from "../board/cameraMath";

export interface BoardPopupPlacement {
  x: number;
  y: number;
  scale: number;
}

/** Popup dimensions are CSS pixels at zoom 1, just like a note's contents. */
export function boardPopupPlacement(
  camera: Camera,
  viewport: Size,
  anchor: Point,
  containingBlockOrigin: Point = { x: 0, y: 0 },
): BoardPopupPlacement {
  const screen = worldToScreen(camera, viewport, anchor);
  return { x: screen.x - containingBlockOrigin.x, y: screen.y - containingBlockOrigin.y, scale: camera.zoom };
}

export function boardPopupStyle(
  camera: Camera,
  viewport: Size,
  anchor: Point,
  containingBlockOrigin?: Point,
): string {
  const { x, y, scale } = boardPopupPlacement(camera, viewport, anchor, containingBlockOrigin);
  return `left:${x}px;top:${y}px;transform:scale(${scale});transform-origin:0 0`;
}

/** Choose a visible initial corner once; later camera changes never reflow the popup. */
export function fitBoardPopupAnchor(
  camera: Camera,
  viewport: Size,
  openedAt: Point,
  size: Size,
): Point {
  const screen = worldToScreen(camera, viewport, openedAt);
  const width = size.width * camera.zoom;
  const height = size.height * camera.zoom;
  const margin = 8;
  const gap = 6 * camera.zoom;
  const maxX = Math.max(margin, viewport.width - width - margin);
  const maxY = Math.max(margin, viewport.height - height - margin);
  const preferredX = screen.x + gap + width <= viewport.width - margin
    ? screen.x + gap : screen.x - gap - width;
  const preferredY = screen.y + gap + height <= viewport.height - margin
    ? screen.y + gap : screen.y - gap - height;
  return screenToWorld(camera, viewport, {
    x: Math.max(margin, Math.min(preferredX, maxX)),
    y: Math.max(margin, Math.min(preferredY, maxY)),
  });
}

/** Pure decision used by the action and tested without a browser DOM. */
export function isOutsidePopup(path: readonly EventTarget[], popup: EventTarget, ignored: readonly EventTarget[] = []): boolean {
  return !path.includes(popup) && ignored.every((target) => !path.includes(target));
}

export interface DismissPopupOptions {
  close: () => void;
  ignoreSelector?: string;
  escape?: boolean;
}

/** Capture-phase dismissal leaves the same pointer action free to reach the board. */
export const dismissBoardPopup: Action<HTMLElement, DismissPopupOptions> = (element, initial) => {
  let options = initial;
  const onPointerDown = (event: PointerEvent) => {
    const path = event.composedPath();
    const ignored = options.ignoreSelector && event.target instanceof Element
      ? event.target.closest(options.ignoreSelector) : null;
    if (isOutsidePopup(path, element, ignored ? [ignored] : [])) options.close();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (options.escape === false || event.code !== "Escape" || event.defaultPrevented) return;
    options.close();
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("keydown", onKeyDown, true);
  return {
    update(next) { options = next; },
    destroy() {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    },
  };
};
