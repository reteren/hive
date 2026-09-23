import type { Camera, Point, Size } from "./cameraMath";

/** The single board camera. ME sits permanently at (0, 0). */
export const camera: Camera = $state({ x: 0, y: 0, zoom: 1 });

/** Board viewport size in CSS pixels, kept current by Board.svelte. */
export const viewport: Size = $state({ width: 0, height: 0 });

/** Last known cursor position in world units, or null when the cursor is off the board. */
export const pointer: { world: Point | null } = $state({ world: null });

export const ME_POSITION: Point = Object.freeze({ x: 0, y: 0 });
