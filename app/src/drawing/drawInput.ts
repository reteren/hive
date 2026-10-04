import { screenToWorld } from "../board/cameraMath";
import { camera, setPointerScreen, viewport } from "../board/camera.svelte";
import { isTextEditingTarget } from "../commands/focus";
import { drawingTools, adjustBrushSize, setActiveDrawTool, showBrushHint, stepBrushSetting, type BrushWheelSetting } from "./tools.svelte";
import { drawToolHandler } from "./toolRegistry";
import { beginEyedropper, cancelEyedropper, finishEyedropper, moveEyedropper } from "./eyedropper.svelte";
import type { DrawPointerEvent, DrawTool, DrawToolHandler } from "./types";
import { tool } from "../tools/tool.svelte";
import { overview } from "../overview/overview.svelte";

export type DrawShortcut =
  | { kind: "tool"; tool: DrawTool }
  | { kind: "size"; delta: number };

const DRAW_SHORTCUTS: Record<string, DrawShortcut> = {
  KeyB: { kind: "tool", tool: "brush" },
  KeyE: { kind: "tool", tool: "eraser" },
  KeyF: { kind: "tool", tool: "fill" },
  KeyM: { kind: "tool", tool: "select-rect" },
  KeyL: { kind: "tool", tool: "select-lasso" },
  KeyP: { kind: "tool", tool: "select-polygon" },
  BracketLeft: { kind: "size", delta: -5 },
  BracketRight: { kind: "size", delta: 5 },
};

/** Ctrl + wheel → size, Alt + wheel → opacity, Shift + wheel → hardness (exactly one modifier). */
export function brushWheelSetting(modifiers: { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }): BrushWheelSetting | null {
  if (modifiers.meta) return null;
  if (modifiers.ctrl && !modifiers.alt && !modifiers.shift) return "size";
  if (modifiers.alt && !modifiers.ctrl && !modifiers.shift) return "opacity";
  if (modifiers.shift && !modifiers.ctrl && !modifiers.alt) return "hardness";
  return null;
}

/** Shortcuts are mode scoped; unmodified keys keep their ordinary board actions in other modes. */
export function drawShortcutForKey(
  code: string,
  drawMode: boolean,
  modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {},
): DrawShortcut | null {
  if (!drawMode || modifiers.ctrl || modifiers.shift || modifiers.alt || modifiers.meta) return null;
  return DRAW_SHORTCUTS[code] ?? null;
}

let selectedTool: DrawTool | null = null;
let selectedHandler: DrawToolHandler | undefined;
let gesturePointerId: number | null = null;
let gestureTool: DrawTool | null = null;
let gestureHandler: DrawToolHandler | undefined;
let inputBoard: HTMLElement | null = null;
let eyedropperPointerId: number | null = null;

/** Attach draw-mode capture handlers to the board while preserving pan and zoom inputs. */
export function attachDrawInput(boardElement: HTMLElement): () => void {
  inputBoard = boardElement;
  function consume(event: Event): void {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function pointerEvent(event: PointerEvent): DrawPointerEvent {
    const bounds = boardElement.getBoundingClientRect();
    const local = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    setPointerScreen(local);
    const world = screenToWorld(camera, viewport, local);
    const pressure = event.pointerType !== "pen" || !Number.isFinite(event.pressure) || event.pressure <= 0
      ? 0.5
      : Math.min(1, Math.max(0, event.pressure));
    return {
      world,
      client: { x: event.clientX, y: event.clientY },
      zoom: camera.zoom,
      pressure,
      shift: event.shiftKey,
      ctrl: event.ctrlKey,
      alt: event.altKey,
      detail: event.detail,
    };
  }

  function refreshHandler(): DrawToolHandler | undefined {
    const nextTool = drawingTools.active;
    const nextHandler = drawToolHandler(nextTool);
    if (selectedTool === nextTool && selectedHandler === nextHandler) return selectedHandler;
    cancelGesture();
    selectedHandler?.deactivate?.();
    selectedTool = nextTool;
    selectedHandler = nextHandler;
    return selectedHandler;
  }

  function clearGesture(releaseCapture: boolean): void {
    const pointerId = gesturePointerId;
    gesturePointerId = null;
    gestureTool = null;
    gestureHandler = undefined;
    if (releaseCapture && pointerId !== null && boardElement.hasPointerCapture(pointerId)) {
      boardElement.releasePointerCapture(pointerId);
    }
  }

  function cancelGesture(): void {
    if (gesturePointerId === null) return;
    const handler = gestureHandler;
    clearGesture(true);
    handler?.cancel();
  }

  function onPointerDown(event: PointerEvent): void {
    if (tool.active !== "draw" || isDrawOverlayControl(event.target)) return;
    if (overview.active) {
      consume(event);
      return;
    }
    if (event.button === 2) {
      // Right button = eyedropper while held; release confirms the colour into the brush.
      consume(event);
      if (gesturePointerId !== null) return;
      eyedropperPointerId = event.pointerId;
      const point = pointerEvent(event);
      beginEyedropper(point, boardElement, event);
      return;
    }
    if (event.button !== 0) return;

    consume(event);
    cancelGesture();
    const handler = refreshHandler();
    gesturePointerId = event.pointerId;
    gestureTool = drawingTools.active;
    gestureHandler = handler;
    try {
      boardElement.setPointerCapture(event.pointerId);
    } catch {
      // The pointer may already have been cancelled by the platform.
    }
    const point = pointerEvent(event);
    handler?.down(point);
  }

  function onPointerMove(event: PointerEvent): void {
    if (overview.active) {
      if (eyedropperPointerId === event.pointerId) {
        consume(event);
        eyedropperPointerId = null;
        cancelEyedropper();
      }
      if (gesturePointerId === event.pointerId) {
        consume(event);
        cancelGesture();
      }
      return;
    }
    if (eyedropperPointerId === event.pointerId && gesturePointerId === null) {
      consume(event);
      const point = pointerEvent(event);
      moveEyedropper(point);
      return;
    }
    if (gesturePointerId !== event.pointerId) return;
    consume(event);
    if (tool.active !== "draw" || gestureTool !== drawingTools.active) {
      cancelGesture();
      return;
    }
    const point = pointerEvent(event);
    gestureHandler?.move(point);
  }

  function onPointerUp(event: PointerEvent): void {
    if (overview.active) {
      if (eyedropperPointerId === event.pointerId) {
        consume(event);
        eyedropperPointerId = null;
        cancelEyedropper();
      }
      if (gesturePointerId === event.pointerId) {
        consume(event);
        cancelGesture();
      }
      return;
    }
    if (eyedropperPointerId === event.pointerId && event.button === 2) {
      consume(event);
      eyedropperPointerId = null;
      const point = pointerEvent(event);
      if (tool.active === "draw") void finishEyedropper(point);
      else cancelEyedropper();
      return;
    }
    if (gesturePointerId !== event.pointerId) return;
    consume(event);
    const handler = gestureHandler;
    const shouldCommit = tool.active === "draw" && gestureTool === drawingTools.active;
    const point = pointerEvent(event);
    clearGesture(true);
    if (shouldCommit) handler?.up(point);
    else handler?.cancel();
  }

  function onPointerCancel(event: PointerEvent): void {
    if (eyedropperPointerId === event.pointerId) {
      eyedropperPointerId = null;
      cancelEyedropper();
      return;
    }
    if (gesturePointerId !== event.pointerId) return;
    consume(event);
    cancelGesture();
  }

  function onLostPointerCapture(event: PointerEvent): void {
    if (gesturePointerId !== event.pointerId) return;
    cancelGesture();
  }

  function onContextMenu(event: MouseEvent): void {
    if (tool.active !== "draw" || isDrawOverlayControl(event.target)) return;
    consume(event);
  }

  let wheelRemainder = 0;
  let wheelSetting: BrushWheelSetting | null = null;

  function onWheel(event: WheelEvent): void {
    if (tool.active !== "draw") return;
    const setting = brushWheelSetting({ ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey });
    if (!setting) return;
    // Before the camera: Ctrl + wheel must not zoom the board while it resizes the brush.
    consume(event);
    if (setting !== wheelSetting) wheelRemainder = 0;
    wheelSetting = setting;
    // Shift + wheel arrives as horizontal scrolling on Windows.
    const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
    const notchDelta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? delta / 3
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? delta : delta / 120;
    wheelRemainder += notchDelta;
    const notches = Math.trunc(wheelRemainder);
    wheelRemainder -= notches;
    if (notches === 0) return;
    // Wheel up = more.
    stepBrushSetting(setting, -notches);
    showBrushHint(setting);
  }

  function onWindowBlur(): void {
    cancelGesture();
    eyedropperPointerId = null;
    cancelEyedropper();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (tool.active !== "draw") {
      deactivateDrawInput();
      return;
    }
    // Leave the Alt modifier alone for OverviewLayer; drawing shortcuts must not consume it.
    if (event.key === "Alt" || event.code === "AltLeft" || event.code === "AltRight") return;
    const handler = refreshHandler();
    if (event.code !== "Escape" && (isDrawOverlayControl(event.target) || isTextEditingTarget(event.target) ||
      isTextEditingTarget(document.activeElement))) return;

    if (event.code === "Escape" && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
      if (eyedropperPointerId !== null) {
        eyedropperPointerId = null;
        cancelEyedropper();
        consume(event);
        return;
      }
      // First Esc lets the active tool finish its own state (commit a floating selection, close a
      // polygon); only an Esc the tool does not need leaves draw mode. The tool sees the event before
      // it is consumed, since handlers ignore already-handled (defaultPrevented) keys.
      const handled = handler?.key?.(event) ?? false;
      consume(event);
      if (handled) return;
      deactivateDrawInput();
      tool.active = "select";
      return;
    }
    if (handler?.key?.(event)) {
      consume(event);
      return;
    }

    const shortcut = drawShortcutForKey(event.code, true, {
      ctrl: event.ctrlKey,
      shift: event.shiftKey,
      alt: event.altKey,
      meta: event.metaKey,
    });
    if (!shortcut) return;
    consume(event);
    if (shortcut.kind === "tool") selectDrawingSubtool(shortcut.tool);
    else adjustBrushSize(shortcut.delta);
  }

  boardElement.addEventListener("pointerdown", onPointerDown, true);
  boardElement.addEventListener("pointermove", onPointerMove, true);
  boardElement.addEventListener("pointerup", onPointerUp, true);
  boardElement.addEventListener("pointercancel", onPointerCancel, true);
  boardElement.addEventListener("lostpointercapture", onLostPointerCapture, true);
  boardElement.addEventListener("contextmenu", onContextMenu, true);
  boardElement.addEventListener("wheel", onWheel, { capture: true, passive: false });
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("blur", onWindowBlur);
  selectedTool = null;
  selectedHandler = undefined;

  return () => {
    cancelGesture();
    eyedropperPointerId = null;
    cancelEyedropper();
    selectedHandler?.deactivate?.();
    selectedTool = null;
    selectedHandler = undefined;
    if (inputBoard === boardElement) inputBoard = null;
    boardElement.removeEventListener("pointerdown", onPointerDown, true);
    boardElement.removeEventListener("pointermove", onPointerMove, true);
    boardElement.removeEventListener("pointerup", onPointerUp, true);
    boardElement.removeEventListener("pointercancel", onPointerCancel, true);
    boardElement.removeEventListener("lostpointercapture", onLostPointerCapture, true);
    boardElement.removeEventListener("contextmenu", onContextMenu, true);
    boardElement.removeEventListener("wheel", onWheel, true);
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("blur", onWindowBlur);
  };
}

/** Stop an in-progress gesture and let selection handlers commit their pending state on mode exit. */
export function deactivateDrawInput(): void {
  cancelGesture();
  selectedHandler?.deactivate?.();
  selectedTool = null;
  selectedHandler = undefined;
}

/** Switch subtools only after the previous handler has cancelled/committed its transient state. */
export function selectDrawingSubtool(next: DrawTool): void {
  if (drawingTools.active === next) return;
  deactivateDrawInput();
  setActiveDrawTool(next);
}

function cancelGesture(): void {
  if (gesturePointerId === null) return;
  const handler = gestureHandler;
  const pointerId = gesturePointerId;
  gesturePointerId = null;
  gestureTool = null;
  gestureHandler = undefined;
  if (inputBoard?.hasPointerCapture(pointerId)) inputBoard.releasePointerCapture(pointerId);
  handler?.cancel();
}

function isDrawOverlayControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-draw-overlay-control]") !== null;
}
