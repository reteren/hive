import { cachedClientRect } from "../board/boardRect";
import { screenToWorld } from "../board/cameraMath";
import { camera, setPointerScreen, viewport } from "../board/camera.svelte";
import { isTextEditingTarget } from "../commands/focus";
import { drawingTools, adjustBrushSize, setActiveDrawTool, showBrushHint, stepBrushSetting, type BrushWheelSetting } from "./tools.svelte";
import { drawToolHandler } from "./toolRegistry";
import { beginEyedropper, cancelEyedropper, finishEyedropper, moveEyedropper } from "./eyedropper.svelte";
import type { DrawPointerEvent, DrawTool, DrawToolHandler } from "./types";
import { tool } from "../tools/tool.svelte";
import { overview } from "../overview/overview.svelte";
import {
  beginSelectionBorderMove,
  clearDrawingSelection,
  cancelDrawingSelectionTransform,
  commitDrawingSelectionTransform,
  handleDrawingSelectionKey,
  isDrawingSelectionTransformActive,
  isDrawingSelectionBorder,
  quickSelectionHandler,
  selectionMoveHandler,
  shouldStartQuickSelection,
  trackDrawingSelectionPointer,
  updateDrawingSelectionTransform,
} from "./selection.svelte";

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
  KeyT: { kind: "tool", tool: "text" },
  KeyU: { kind: "tool", tool: "shape" },
  KeyJ: { kind: "tool", tool: "effect" },
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

/** Preempt SelectionLayer's window-capture S handler, which is registered before draw mode mounts. */
function preemptBoardSelectionTransform(event: KeyboardEvent): void {
  if (tool.active !== "draw" || event.defaultPrevented || event.isComposing ||
    (event.code !== "KeyG" && event.code !== "KeyS") ||
    isTextEditingTarget(event.target) || isTextEditingTarget(document.activeElement)) return;
  if (!handleDrawingSelectionKey(event)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

if (typeof window !== "undefined") window.addEventListener("keydown", preemptBoardSelectionTransform, true);

/** Attach draw-mode capture handlers to the board while preserving pan and zoom inputs. */
export function attachDrawInput(boardElement: HTMLElement): () => void {
  inputBoard = boardElement;
  const transformedPointerMoves = new WeakSet<Event>();
  function consume(event: Event): void {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function setSelectionMoveHover(active: boolean): void {
    if (active) document.documentElement.dataset.selectionMoveHover = "true";
    else delete document.documentElement.dataset.selectionMoveHover;
  }

  function pointerEvent(event: PointerEvent): DrawPointerEvent {
    const bounds = cachedClientRect(boardElement);
    const local = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    setPointerScreen(local);
    const world = screenToWorld(camera, viewport, local);
    const pressure = event.pointerType !== "pen" || !Number.isFinite(event.pressure) || event.pressure <= 0
      ? 0.5
      : Math.min(1, Math.max(0, event.pressure));
    const point: DrawPointerEvent = {
      world,
      client: { x: event.clientX, y: event.clientY },
      zoom: camera.zoom,
      pressure,
      shift: event.shiftKey,
      ctrl: event.ctrlKey,
      alt: event.altKey,
      detail: event.detail,
    };
    trackDrawingSelectionPointer(point);
    return point;
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

  function onTransformPointerMove(event: PointerEvent): void {
    if (tool.active !== "draw" || !isDrawingSelectionTransformActive()) return;
    updateDrawingSelectionTransform(pointerEvent(event));
    transformedPointerMoves.add(event);
  }

  function onPointerDown(event: PointerEvent): void {
    if (tool.active !== "draw") return;
    if (isDrawOverlayControl(event.target)) {
      setSelectionMoveHover(false);
      return;
    }
    if (isDrawingSelectionTransformActive()) {
      if (event.button !== 0 && event.button !== 2) return;
      setSelectionMoveHover(false);
      consume(event);
      const point = pointerEvent(event);
      if (event.button === 2) cancelDrawingSelectionTransform();
      else commitDrawingSelectionTransform(point);
      return;
    }
    if (overview.active) {
      setSelectionMoveHover(false);
      consume(event);
      return;
    }
    if (event.button === 2) {
      // Right button = eyedropper while held; release confirms the colour into the brush.
      setSelectionMoveHover(false);
      consume(event);
      // R10.8: in Effects the right button does not pick a colour.
      if (gesturePointerId !== null || drawingTools.active === "effect") return;
      eyedropperPointerId = event.pointerId;
      const point = pointerEvent(event);
      const usesCaptureOverlay = beginEyedropper(point, boardElement, event);
      if (!usesCaptureOverlay) {
        try {
          boardElement.setPointerCapture(event.pointerId);
        } catch {
          // The pointer may already have been cancelled by the platform.
        }
      }
      return;
    }
    if (event.button !== 0) return;

    setSelectionMoveHover(false);
    consume(event);
    cancelGesture();
    const handler = refreshHandler();
    gesturePointerId = event.pointerId;
    gestureTool = drawingTools.active;
    try {
      boardElement.setPointerCapture(event.pointerId);
    } catch {
      // The pointer may already have been cancelled by the platform.
    }
    const point = pointerEvent(event);
    const movedSelection = beginSelectionBorderMove(point);
    if (movedSelection) {
      gestureHandler = selectionMoveHandler;
      setSelectionMoveHover(true);
    } else if (shouldStartQuickSelection(drawingTools.active, point, movedSelection)) {
      gestureHandler = quickSelectionHandler;
      gestureHandler.down(point);
    }
    else {
      gestureHandler = handler;
      handler?.down(point);
    }
  }

  function onPointerMove(event: PointerEvent): void {
    if (transformedPointerMoves.has(event)) {
      consume(event);
      return;
    }
    if (tool.active === "draw" && isDrawingSelectionTransformActive()) {
      consume(event);
      updateDrawingSelectionTransform(pointerEvent(event));
      return;
    }
    if (overview.active) {
      setSelectionMoveHover(false);
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
    if (gesturePointerId !== event.pointerId) {
      if (tool.active === "draw" && !overview.active && !isDrawOverlayControl(event.target)) {
        setSelectionMoveHover(isDrawingSelectionBorder(pointerEvent(event)));
      } else {
        setSelectionMoveHover(false);
      }
      return;
    }
    consume(event);
    if (tool.active !== "draw" || gestureTool !== drawingTools.active) {
      setSelectionMoveHover(false);
      cancelGesture();
      return;
    }
    setSelectionMoveHover(gestureHandler === selectionMoveHandler);
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
      if (boardElement.hasPointerCapture(event.pointerId)) boardElement.releasePointerCapture(event.pointerId);
      const point = pointerEvent(event);
      if (tool.active === "draw") void finishEyedropper(point);
      else cancelEyedropper();
      return;
    }
    if (gesturePointerId !== event.pointerId) return;
    setSelectionMoveHover(false);
    consume(event);
    const handler = gestureHandler;
    const shouldCommit = tool.active === "draw" && gestureTool === drawingTools.active;
    const wasSelectionMove = handler === selectionMoveHandler;
    const point = pointerEvent(event);
    clearGesture(true);
    if (shouldCommit) handler?.up(point);
    else handler?.cancel();
    setSelectionMoveHover(shouldCommit && (wasSelectionMove || isDrawingSelectionBorder(point)));
  }

  function onPointerCancel(event: PointerEvent): void {
    if (eyedropperPointerId === event.pointerId) {
      eyedropperPointerId = null;
      cancelEyedropper();
      return;
    }
    if (gesturePointerId !== event.pointerId) return;
    consume(event);
    setSelectionMoveHover(false);
    cancelGesture();
  }

  function onLostPointerCapture(event: PointerEvent): void {
    if (gesturePointerId !== event.pointerId) return;
    setSelectionMoveHover(false);
    cancelGesture();
  }

  function onPointerLeave(): void {
    if (gesturePointerId === null) setSelectionMoveHover(false);
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
    cancelDrawingSelectionTransform();
    setSelectionMoveHover(false);
    eyedropperPointerId = null;
    cancelEyedropper();
  }

  function onAltKeyUp(event: KeyboardEvent): void {
    if (tool.active !== "draw") return;
    if (event.key === "Alt" || event.code === "AltLeft" || event.code === "AltRight") event.preventDefault();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (tool.active !== "draw") {
      deactivateDrawInput();
      return;
    }
    // A lone Alt press puts the Windows window into menu mode (the pointer stutters and the system
    // cursor flashes). The Alt overview is off in draw mode, so the key is swallowed here.
    if (event.key === "Alt" || event.code === "AltLeft" || event.code === "AltRight") {
      event.preventDefault();
      return;
    }
    const handler = refreshHandler();
    if (event.code !== "Escape" && (isDrawOverlayControl(event.target) || isTextEditingTarget(event.target) ||
      isTextEditingTarget(document.activeElement))) return;

    if (handleDrawingSelectionKey(event)) {
      consume(event);
      return;
    }

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
  boardElement.addEventListener("pointerleave", onPointerLeave, true);
  boardElement.addEventListener("contextmenu", onContextMenu, true);
  boardElement.addEventListener("wheel", onWheel, { capture: true, passive: false });
  window.addEventListener("pointermove", onTransformPointerMove, true);
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onAltKeyUp, true);
  window.addEventListener("blur", onWindowBlur);
  selectedTool = null;
  selectedHandler = undefined;

  return () => {
    cancelGesture();
    setSelectionMoveHover(false);
    eyedropperPointerId = null;
    cancelEyedropper();
    selectedHandler?.deactivate?.();
    clearDrawingSelection();
    selectedTool = null;
    selectedHandler = undefined;
    if (inputBoard === boardElement) inputBoard = null;
    boardElement.removeEventListener("pointerdown", onPointerDown, true);
    boardElement.removeEventListener("pointermove", onPointerMove, true);
    boardElement.removeEventListener("pointerup", onPointerUp, true);
    boardElement.removeEventListener("pointercancel", onPointerCancel, true);
    boardElement.removeEventListener("lostpointercapture", onLostPointerCapture, true);
    boardElement.removeEventListener("pointerleave", onPointerLeave, true);
    boardElement.removeEventListener("contextmenu", onContextMenu, true);
    boardElement.removeEventListener("wheel", onWheel, true);
    window.removeEventListener("pointermove", onTransformPointerMove, true);
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onAltKeyUp, true);
    window.removeEventListener("blur", onWindowBlur);
  };
}

/** Stop an in-progress gesture and let selection handlers commit their pending state on mode exit. */
export function deactivateDrawInput(clearSelection = true): void {
  cancelGesture();
  cancelDrawingSelectionTransform();
  selectedHandler?.deactivate?.();
  clearSelectionHover();
  if (clearSelection) clearDrawingSelection();
  selectedTool = null;
  selectedHandler = undefined;
}

/** Switch subtools only after the previous handler has cancelled/committed its transient state. */
export function selectDrawingSubtool(next: DrawTool): void {
  if (drawingTools.active === next) return;
  deactivateDrawInput(false);
  setActiveDrawTool(next);
}

function clearSelectionHover(): void {
  if (typeof document !== "undefined") delete document.documentElement.dataset.selectionMoveHover;
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
