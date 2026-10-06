import type { Action } from "svelte/action";
import { screenToWorld, worldToScreen, type Camera, type Point, type Size } from "../board/cameraMath";
import { isScreenColorPicking } from "../color/screenPicker.svelte";

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
  zoomAtOpen: number,
  containingBlockOrigin: Point = { x: 0, y: 0 },
): BoardPopupPlacement {
  const screen = worldToScreen(camera, viewport, anchor);
  const openedZoom = Number.isFinite(zoomAtOpen) && zoomAtOpen > 0 ? zoomAtOpen : camera.zoom;
  return {
    x: screen.x - containingBlockOrigin.x,
    y: screen.y - containingBlockOrigin.y,
    scale: camera.zoom / openedZoom,
  };
}

export function boardPopupStyle(
  camera: Camera,
  viewport: Size,
  anchor: Point,
  zoomAtOpen: number,
  containingBlockOrigin?: Point,
): string {
  const { x, y, scale } = boardPopupPlacement(camera, viewport, anchor, zoomAtOpen, containingBlockOrigin);
  return `left:${x}px;top:${y}px;transform:scale(${scale});transform-origin:0 0`;
}

/** Keep a popup at a captured viewport point, independent of subsequent camera movement. */
export function screenAnchoredPopupStyle(anchor: Point): string {
  return `left:${anchor.x}px;top:${anchor.y}px;transform:none;transform-origin:0 0`;
}

/** Choose a visible initial corner once; later camera changes never reflow the popup. */
export function fitBoardPopupAnchor(
  camera: Camera,
  viewport: Size,
  openedAt: Point,
  size: Size,
): Point {
  const screen = worldToScreen(camera, viewport, openedAt);
  const width = size.width;
  const height = size.height;
  const margin = 8;
  const gap = 6;
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

/** Pure pointer-dismissal decision so pinned popups can stay open outside their bounds. */
export function shouldDismissOnOutsidePointer(
  path: readonly EventTarget[],
  popup: EventTarget,
  ignored: readonly EventTarget[] = [],
  enabled = true,
): boolean {
  return enabled && isOutsidePopup(path, popup, ignored);
}

export interface DismissPopupOptions {
  close: () => void;
  ignoreSelector?: string;
  escape?: boolean;
  shouldDismissOutside?: () => boolean;
}

/** Capture-phase dismissal leaves the same pointer action free to reach the board. */
export const dismissBoardPopup: Action<HTMLElement, DismissPopupOptions> = (element, initial) => {
  let options = initial;
  const onPointerDown = (event: PointerEvent) => {
    // The HEX palette's eyedropper overlay takes clicks/Esc for itself; the popover must stay open.
    if (isScreenColorPicking()) return;
    const path = event.composedPath();
    const ignored = options.ignoreSelector && event.target instanceof Element
      ? event.target.closest(options.ignoreSelector) : null;
    if (shouldDismissOnOutsidePointer(path, element, ignored ? [ignored] : [], options.shouldDismissOutside?.() ?? true)) {
      options.close();
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (options.escape === false || event.code !== "Escape" || event.defaultPrevented || isScreenColorPicking()) return;
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
