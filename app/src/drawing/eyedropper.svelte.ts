import { invoke, isTauri } from "@tauri-apps/api/core";
import { readCompositeRect } from "./history";
import { setBrushSettings } from "./tools.svelte";
import { currentDrawLevel, levelPxPerUnit } from "./types";

type ClientPoint = { x: number; y: number };
type EyedropperPoint = { world: { x: number; y: number }; zoom: number; client: ClientPoint };
type NativeSample = { session: number; revision: number; client: ClientPoint };

/**
 * Right mouse button in draw mode is the eyedropper: while it is held the colour under the cursor is
 * previewed (swatch + HEX next to the cursor); releasing it makes that colour the brush colour.
 * Desktop samples the actual window pixel; browser/dev keeps sampling the drawing composite.
 */
export const eyedropper = $state({
  active: false,
  color: null as string | null,
});

export function rgbToHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

/** Colour of the drawing at a world point, or null where nothing is drawn. */
export function sampleDrawingColor(world: { x: number; y: number }, zoom: number): string | null {
  const level = currentDrawLevel(zoom);
  const ppu = levelPxPerUnit(level);
  const x = Math.floor(world.x * ppu);
  const y = Math.floor(world.y * ppu);
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return null;
  const data = readCompositeRect(x, y, 1, 1, level).data;
  return data[3]! > 0 ? rgbToHex(data[0]!, data[1]!, data[2]!) : null;
}

let activeSession = 0;
let latestNativeRevision = 0;
let completedNativeRevision = 0;
let pendingNativeSample: NativeSample | null = null;
let nativeSampleInFlight = false;
let nativeSampleFrame: number | null = null;
let nativeFinishTarget: number | null = null;
let nativeFinishResolver: (() => void) | null = null;
let finishingEyedropper = false;

type CaptureOverlay = {
  element: HTMLDivElement;
  pointerId: number;
};

let captureOverlay: CaptureOverlay | null = null;

export function beginEyedropper(
  point: EyedropperPoint,
  board: HTMLElement,
  pointerDown: PointerEvent,
): boolean {
  activeSession += 1;
  removeCaptureOverlay();
  resetNativeSampling();
  finishingEyedropper = false;
  eyedropper.active = true;

  if (isTauri()) {
    eyedropper.color = null;
    const overlayInstalled = installCaptureOverlay(board, pointerDown);
    queueNativeSample(point.client);
    return overlayInstalled;
  } else {
    eyedropper.color = sampleDrawingColor(point.world, point.zoom);
    return false;
  }
}

export function moveEyedropper(point: EyedropperPoint): void {
  if (!eyedropper.active) return;
  if (isTauri()) queueNativeSample(point.client);
  else eyedropper.color = sampleDrawingColor(point.world, point.zoom);
}

/** Release: sample the final pointer location, then commit its previewed colour into the brush. */
export async function finishEyedropper(point: EyedropperPoint): Promise<void> {
  if (!eyedropper.active) return;
  const session = activeSession;
  finishingEyedropper = true;

  if (isTauri()) {
    const revision = queueNativeSample(point.client);
    await waitForNativeSample(revision);
  } else {
    eyedropper.color = sampleDrawingColor(point.world, point.zoom);
  }

  if (session !== activeSession || !eyedropper.active) return;
  removeCaptureOverlay();
  if (eyedropper.color) setBrushSettings({ color: eyedropper.color });
  cancelEyedropper();
}

export function cancelEyedropper(): void {
  activeSession += 1;
  finishingEyedropper = false;
  eyedropper.active = false;
  eyedropper.color = null;
  removeCaptureOverlay();
  resetNativeSampling();
}

function queueNativeSample(client: ClientPoint): number {
  const revision = ++latestNativeRevision;
  pendingNativeSample = { session: activeSession, revision, client };
  scheduleNativeSample();
  return revision;
}

function scheduleNativeSample(): void {
  if (nativeSampleFrame !== null || nativeSampleInFlight || !pendingNativeSample) return;
  nativeSampleFrame = requestAnimationFrame(() => {
    nativeSampleFrame = null;
    startNativeSample();
  });
}

function startNativeSample(): void {
  if (nativeSampleInFlight || !pendingNativeSample) return;
  const sample = pendingNativeSample;
  pendingNativeSample = null;
  nativeSampleInFlight = true;

  void invoke<string | null>("sample_screen_pixel", {
    clientX: sample.client.x,
    clientY: sample.client.y,
  }).then((color) => {
    if (sample.session === activeSession && sample.revision === latestNativeRevision && color) {
      eyedropper.color = color;
    }
  }).catch(() => undefined).finally(() => {
    nativeSampleInFlight = false;
    completedNativeRevision = Math.max(completedNativeRevision, sample.revision);
    if (pendingNativeSample) scheduleNativeSample();
    settleNativeFinish();
  });
}

function waitForNativeSample(revision: number): Promise<void> {
  return new Promise((resolve) => {
    nativeFinishTarget = revision;
    nativeFinishResolver = resolve;
    settleNativeFinish();
  });
}

function settleNativeFinish(): void {
  if (nativeFinishTarget === null || nativeSampleInFlight || pendingNativeSample ||
    completedNativeRevision < nativeFinishTarget) return;
  nativeFinishTarget = null;
  const resolve = nativeFinishResolver;
  nativeFinishResolver = null;
  resolve?.();
}

function resetNativeSampling(): void {
  if (nativeSampleFrame !== null) cancelAnimationFrame(nativeSampleFrame);
  nativeSampleFrame = null;
  pendingNativeSample = null;
  nativeFinishTarget = null;
  const resolve = nativeFinishResolver;
  nativeFinishResolver = null;
  resolve?.();
}

function installCaptureOverlay(board: HTMLElement, pointerDown: PointerEvent): boolean {
  if (!document.body) return false;
  const element = document.createElement("div");
  element.setAttribute("aria-hidden", "true");
  element.dataset.eyedropperCapture = "";
  Object.assign(element.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    background: "transparent",
    cursor: "none",
    touchAction: "none",
    userSelect: "none",
  });

  const pointerId = pointerDown.pointerId;
  element.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId) return;
    consumeNativeEvent(event);
    if (finishingEyedropper) return;
    if ((event.buttons & 2) === 0) {
      forwardPointerEvent(board, event, "pointerup", 2, 0);
      return;
    }
    forwardPointerEvent(board, event);
  });
  element.addEventListener("pointerup", (event) => {
    if (event.pointerId !== pointerId) return;
    consumeNativeEvent(event);
    if (finishingEyedropper) return;
    forwardPointerEvent(board, event);
  });
  element.addEventListener("pointercancel", (event) => {
    if (event.pointerId !== pointerId) return;
    consumeNativeEvent(event);
    forwardPointerEvent(board, event);
  });
  element.addEventListener("contextmenu", consumeNativeEvent);
  document.body.append(element);
  captureOverlay = { element, pointerId };

  try {
    // The overlay receives movement and release even while the pointer crosses a child webview/iframe.
    element.setPointerCapture(pointerId);
  } catch {
    // The full-window hit target still captures events while the pointer remains inside the app.
  }
  return true;
}

function forwardPointerEvent(
  board: HTMLElement,
  event: PointerEvent,
  type: string = event.type,
  button: number = event.button,
  buttons: number = event.buttons,
): void {
  const forwarded = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    isPrimary: event.isPrimary,
    clientX: event.clientX,
    clientY: event.clientY,
    screenX: event.screenX,
    screenY: event.screenY,
    button,
    buttons,
    detail: event.detail,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
    pressure: event.pressure,
    width: event.width,
    height: event.height,
  });
  board.dispatchEvent(forwarded);
}

function consumeNativeEvent(event: Event): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function removeCaptureOverlay(): void {
  const current = captureOverlay;
  captureOverlay = null;
  if (!current) return;
  try {
    if (current.element.hasPointerCapture(current.pointerId)) {
      current.element.releasePointerCapture(current.pointerId);
    }
  } catch {
    // Pointer capture may already have ended during pointercancel or window deactivation.
  }
  current.element.remove();
}
