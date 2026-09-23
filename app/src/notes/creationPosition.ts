import { snapToGrid } from "../board/gridMath";
import { worldToScreen, type Camera, type Point, type Size } from "../board/cameraMath";

export type CreationTrigger = "keyboard" | "toolbar";

export interface CreationOrigin {
  world: Point;
  screen: Point;
}

export interface MenuSize {
  width: number;
  height: number;
}

/** Keyboard creation follows the board cursor; toolbar creation uses the view centre. */
export function chooseCreationOrigin(
  trigger: CreationTrigger,
  cursorWorld: Point | null,
  camera: Camera,
  viewport: Size,
): CreationOrigin {
  if (trigger === "keyboard" && cursorWorld) {
    return {
      world: { ...cursorWorld },
      screen: worldToScreen(camera, viewport, cursorWorld),
    };
  }

  return {
    world: { x: camera.x, y: camera.y },
    screen: { x: viewport.width / 2, y: viewport.height / 2 },
  };
}

/** Centre a note on the chosen point, optionally snapping that centre to the grid. */
export function notePositionAt(
  center: Point,
  width: number,
  height: number,
  snap: boolean,
  step: number,
): Point {
  const placedCenter = snap ? snapToGrid(center, step) : center;
  return {
    x: placedCenter.x - width / 2,
    y: placedCenter.y - height / 2,
  };
}

/** Place the transient menu beside its anchor while keeping it within the viewport. */
export function createMenuPosition(anchor: Point, viewport: Size, menu: MenuSize): Point {
  const margin = 8;
  const gap = 10;
  const maxX = Math.max(margin, viewport.width - menu.width - margin);
  const maxY = Math.max(margin, viewport.height - menu.height - margin);
  const preferredX = anchor.x + gap + menu.width <= viewport.width - margin
    ? anchor.x + gap
    : anchor.x - gap - menu.width;
  const preferredY = anchor.y + gap + menu.height <= viewport.height - margin
    ? anchor.y + gap
    : anchor.y - gap - menu.height;

  return {
    x: Math.min(maxX, Math.max(margin, preferredX)),
    y: Math.min(maxY, Math.max(margin, preferredY)),
  };
}
