import { screenToWorld, type Camera, type Point, type Size } from "./cameraMath";

/** The single board camera. ME sits permanently at (0, 0). */
export const camera: Camera = $state({ x: 0, y: 0, zoom: 1 });

/** Plain camera preferences; persistence is added in R0.5. */
export const cameraSettings = $state({
  minZoom: 0.05,
  maxZoom: 8,
  zoomSensitivity: 0.0015,
  panSpeed: 600,
});

/** Board viewport size in CSS pixels, kept current by Board.svelte. */
export const viewport: Size = $state({ width: 0, height: 0 });

/** Last known cursor position in world units, or null when the cursor is off the board. */
export const pointer: { world: Point | null } = $state({ world: null });

let pointerScreen: Point | null = null;
let transientCameraChangeDepth = 0;

/** Suppress persisting a camera snapshot while a caller temporarily moves the board camera. */
export function beginTransientCameraChange(): () => void {
  transientCameraChangeDepth += 1;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    transientCameraChangeDepth = Math.max(0, transientCameraChangeDepth - 1);
  };
}

export function isTransientCameraChange(): boolean {
  return transientCameraChangeDepth > 0;
}

/** Keep the pointer's world coordinate in sync with camera changes. */
export function refreshPointerWorld(): void {
  pointer.world = pointerScreen ? screenToWorld(camera, viewport, pointerScreen) : null;
}

/** Record the board-local cursor position, or clear it when the cursor leaves. */
export function setPointerScreen(screen: Point | null): void {
  pointerScreen = screen ? { ...screen } : null;
  refreshPointerWorld();
}

export const ME_POSITION: Point = Object.freeze({ x: 0, y: 0 });
