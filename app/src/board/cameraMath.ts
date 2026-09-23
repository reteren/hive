/**
 * Board coordinates are in units (u), not monitor pixels.
 * The camera stores the world point shown at the viewport centre plus a zoom
 * factor; at zoom 1 one unit is PX_PER_UNIT CSS pixels. World Y grows downwards.
 */
export const PX_PER_UNIT = 10;

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export function pixelsPerUnit(camera: Camera): number {
  return PX_PER_UNIT * camera.zoom;
}

export function worldToScreen(camera: Camera, viewport: Size, world: Point): Point {
  const ppu = pixelsPerUnit(camera);
  return {
    x: (world.x - camera.x) * ppu + viewport.width / 2,
    y: (world.y - camera.y) * ppu + viewport.height / 2,
  };
}

export function screenToWorld(camera: Camera, viewport: Size, screen: Point): Point {
  const ppu = pixelsPerUnit(camera);
  return {
    x: (screen.x - viewport.width / 2) / ppu + camera.x,
    y: (screen.y - viewport.height / 2) / ppu + camera.y,
  };
}
