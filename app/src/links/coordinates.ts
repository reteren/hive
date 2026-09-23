import { screenToWorld, type Camera, type Point, type Size } from "../board/cameraMath";

export interface ClientRect {
  left: number;
  top: number;
}

/** Convert a window pointer position to the board's local CSS-pixel coordinates. */
export function clientToBoardPoint(client: Point, rect: ClientRect): Point {
  return { x: client.x - rect.left, y: client.y - rect.top };
}

/** Convert a window pointer position through the board-local viewport into world units. */
export function clientToWorld(client: Point, rect: ClientRect, camera: Camera, viewport: Size): Point {
  return screenToWorld(camera, viewport, clientToBoardPoint(client, rect));
}
