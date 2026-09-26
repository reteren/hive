import { camera, cameraSettings, refreshPointerWorld, setPointerScreen, viewport } from "./camera.svelte";
import { pixelsPerUnit, zoomAt, type Point } from "./cameraMath";
import { isTextEditingTarget } from "../commands/focus";

const PAN_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);
const SHIFT_SPEED_MULTIPLIER = 2.5;

/**
 * Camera input on the board element (R0.2): MMB drag, WASD, wheel zoom around the cursor.
 * Returns a function that detaches every listener.
 */
export function attachCameraInput(board: HTMLElement): () => void {
  let dragPointerId: number | null = null;
  let lastDragPosition: Point | null = null;
  let dragFrameId: number | null = null;
  let pendingWorldDelta = { x: 0, y: 0 };
  let pendingPointerScreen: Point | null = null;
  let hasPendingPointerScreen = false;
  let frameId: number | null = null;
  let lastFrameTime: number | null = null;
  let shiftHeld = false;
  const heldKeys = new Set<string>();
  const originalCursor = board.style.cursor;

  board.style.cursor = "grab";

  function localPoint(clientX: number, clientY: number): Point | null {
    const rect = board.getBoundingClientRect();
    const point = { x: clientX - rect.left, y: clientY - rect.top };
    if (point.x < 0 || point.y < 0 || point.x > rect.width || point.y > rect.height) {
      return null;
    }
    return point;
  }

  function updatePointer(clientX: number, clientY: number): Point | null {
    const point = localPoint(clientX, clientY);
    setPointerScreen(point);
    return point;
  }

  function stopPanLoop(): void {
    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
    lastFrameTime = null;
  }

  function clearHeldKeys(): void {
    heldKeys.clear();
    shiftHeld = false;
    stopPanLoop();
  }

  function panFrame(time: number): void {
    frameId = null;
    if (heldKeys.size === 0) {
      lastFrameTime = null;
      return;
    }

    if (isTextEditingTarget(document.activeElement)) {
      clearHeldKeys();
      return;
    }

    const elapsed = lastFrameTime === null ? 0 : Math.max(0, (time - lastFrameTime) / 1000);
    lastFrameTime = time;

    let xDirection = Number(heldKeys.has("KeyD")) - Number(heldKeys.has("KeyA"));
    let yDirection = Number(heldKeys.has("KeyS")) - Number(heldKeys.has("KeyW"));
    const directionLength = Math.hypot(xDirection, yDirection);

    if (directionLength > 0 && elapsed > 0) {
      xDirection /= directionLength;
      yDirection /= directionLength;
      const speed = cameraSettings.panSpeed * (shiftHeld ? SHIFT_SPEED_MULTIPLIER : 1);
      const distance = speed * elapsed / pixelsPerUnit(camera);
      camera.x += xDirection * distance;
      camera.y += yDirection * distance;
      refreshPointerWorld();
    }

    if (heldKeys.size > 0) {
      frameId = requestAnimationFrame(panFrame);
    } else {
      lastFrameTime = null;
    }
  }

  function startPanLoop(): void {
    if (frameId === null) {
      lastFrameTime = null;
      frameId = requestAnimationFrame(panFrame);
    }
  }

  function scheduleDragFrame(): void {
    if (dragFrameId !== null) return;
    dragFrameId = requestAnimationFrame(flushDragFrame);
  }

  function flushDragFrame(): void {
    if (dragFrameId !== null) cancelAnimationFrame(dragFrameId);
    dragFrameId = null;
    if (hasPendingPointerScreen) {
      setPointerScreen(pendingPointerScreen);
      pendingPointerScreen = null;
      hasPendingPointerScreen = false;
    }
    if (pendingWorldDelta.x !== 0 || pendingWorldDelta.y !== 0) {
      camera.x += pendingWorldDelta.x;
      camera.y += pendingWorldDelta.y;
      pendingWorldDelta = { x: 0, y: 0 };
      refreshPointerWorld();
    }
  }

  function endDrag(pointerId: number, releaseCapture: boolean): void {
    if (dragPointerId !== pointerId) return;

    flushDragFrame();
    dragPointerId = null;
    lastDragPosition = null;
    board.style.cursor = "grab";

    if (releaseCapture && board.hasPointerCapture(pointerId)) {
      board.releasePointerCapture(pointerId);
    }
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 1) return;

    event.preventDefault();
    dragPointerId = event.pointerId;
    lastDragPosition = { x: event.clientX, y: event.clientY };
    pendingWorldDelta = { x: 0, y: 0 };
    pendingPointerScreen = null;
    hasPendingPointerScreen = false;
    board.setPointerCapture(event.pointerId);
    board.style.cursor = "grabbing";
    updatePointer(event.clientX, event.clientY);
  }

  function onPointerMove(event: PointerEvent): void {
    if (dragPointerId === event.pointerId && lastDragPosition) {
      const deltaX = event.clientX - lastDragPosition.x;
      const deltaY = event.clientY - lastDragPosition.y;
      lastDragPosition = { x: event.clientX, y: event.clientY };
      const ppu = pixelsPerUnit(camera);
      pendingWorldDelta.x -= deltaX / ppu;
      pendingWorldDelta.y -= deltaY / ppu;
      pendingPointerScreen = localPoint(event.clientX, event.clientY);
      hasPendingPointerScreen = true;
      scheduleDragFrame();
      return;
    }

    updatePointer(event.clientX, event.clientY);
  }

  function onPointerUp(event: PointerEvent): void {
    endDrag(event.pointerId, true);
  }

  function onPointerLeave(): void {
    setPointerScreen(null);
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();

    const screenPoint = updatePointer(event.clientX, event.clientY);
    if (!screenPoint) return;

    const deltaPixels = event.deltaY * wheelDeltaScale(event.deltaMode, board);
    const boundedDelta = Math.min(2000, Math.max(-2000, deltaPixels));
    const factor = Math.exp(-boundedDelta * cameraSettings.zoomSensitivity);
    const zoomed = zoomAt(camera, viewport, screenPoint, factor, cameraSettings);
    camera.x = zoomed.x;
    camera.y = zoomed.y;
    camera.zoom = zoomed.zoom;
    refreshPointerWorld();
  }

  function onKeyDown(event: KeyboardEvent): void {
    shiftHeld = event.shiftKey;
    if (!PAN_KEYS.has(event.code)) return;
    if (event.ctrlKey || event.altKey || event.metaKey || isTextEditingTarget(event.target)) return;
    if (isTextEditingTarget(document.activeElement)) return;

    event.preventDefault();
    heldKeys.add(event.code);
    startPanLoop();
  }

  function onKeyUp(event: KeyboardEvent): void {
    shiftHeld = event.shiftKey;
    if (!PAN_KEYS.has(event.code)) return;

    heldKeys.delete(event.code);
    if (heldKeys.size === 0) stopPanLoop();
  }

  function onWindowBlur(): void {
    clearHeldKeys();
    if (dragPointerId !== null) endDrag(dragPointerId, true);
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === "hidden") clearHeldKeys();
  }

  function onMiddleMouseDefault(event: MouseEvent): void {
    if (event.button === 1) event.preventDefault();
  }

  board.addEventListener("pointerdown", onPointerDown);
  board.addEventListener("pointermove", onPointerMove);
  board.addEventListener("pointerup", onPointerUp);
  board.addEventListener("pointercancel", onPointerUp);
  board.addEventListener("lostpointercapture", onPointerUp);
  board.addEventListener("pointerleave", onPointerLeave);
  board.addEventListener("mousedown", onMiddleMouseDefault);
  board.addEventListener("auxclick", onMiddleMouseDefault);
  board.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onWindowBlur);
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    clearHeldKeys();
    if (dragPointerId !== null) endDrag(dragPointerId, true);
    if (dragFrameId !== null) cancelAnimationFrame(dragFrameId);

    board.removeEventListener("pointerdown", onPointerDown);
    board.removeEventListener("pointermove", onPointerMove);
    board.removeEventListener("pointerup", onPointerUp);
    board.removeEventListener("pointercancel", onPointerUp);
    board.removeEventListener("lostpointercapture", onPointerUp);
    board.removeEventListener("pointerleave", onPointerLeave);
    board.removeEventListener("mousedown", onMiddleMouseDefault);
    board.removeEventListener("auxclick", onMiddleMouseDefault);
    board.removeEventListener("wheel", onWheel);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onWindowBlur);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    board.style.cursor = originalCursor;
    setPointerScreen(null);
  };
}

function wheelDeltaScale(deltaMode: number, board: HTMLElement): number {
  if (deltaMode === WheelEvent.DOM_DELTA_LINE) return 16;
  if (deltaMode === WheelEvent.DOM_DELTA_PAGE) return Math.max(1, board.clientHeight);
  return 1;
}
