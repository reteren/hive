import type { Point } from "../board/cameraMath";

/**
 * Camera jumps ("teleports") used by search, links to points/objects and the objects panel
 * (R2.4–R2.6). Unlike ordinary camera movement, a teleport is recorded in the navigation
 * history and in the unified Undo history (roadmap R2.6). Implemented by the navigation worker.
 */
export interface TeleportOptions {
  /** Short reason for the Undo log, e.g. "Search", "Go to point". */
  label: string;
  /** Record in Undo/navigation history (default true). */
  record?: boolean;
}

/** Centre the camera on a board point (zoom unchanged). */
export function teleportToPoint(_point: Point, _options: TeleportOptions): void {}

/** Centre the camera on an object and select it. Returns false if the object doesn't exist. */
export function teleportToObject(_objectId: string, _options: TeleportOptions): boolean {
  return false;
}
