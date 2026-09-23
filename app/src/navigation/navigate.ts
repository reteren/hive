import type { Point } from "../board/cameraMath";
import { camera, refreshPointerWorld } from "../board/camera.svelte";
import { board } from "../model/board.svelte";
import { noteBounds } from "../notes/layout.svelte";
import { selectOnly } from "../selection/selection.svelte";
import { execute } from "../history/history.svelte";
import { registerCommand } from "../commands/registry.svelte";
import { objectsPanel, toggleObjectsPanel } from "./panelState.svelte";
import {
  canNavigateBack,
  canNavigateForward,
  navigateBack,
  navigateForward,
  pointNavigationAt,
  pushNavigation,
} from "./navigationHistory.svelte";

registerCommand({
  id: "ui.toggleObjectsPanel",
  label: "Toggle Objects Panel",
  keys: ["Alt+KeyO"],
  run: toggleObjectsPanel,
  isActive: () => objectsPanel.open,
});

/**
 * Camera jumps ("teleports") used by search, links to points/objects and the objects panel
 * (R2.4–R2.6). Unlike ordinary camera movement, a teleport is recorded in the navigation
 * history and in the unified Undo history (roadmap R2.6).
 */
export interface TeleportOptions {
  /** Short reason for the Undo log, e.g. "Search", "Go to point". */
  label: string;
  /** Record in Undo/navigation history (default true). */
  record?: boolean;
}

function cameraSnapshot(): { x: number; y: number; zoom: number } {
  return { x: camera.x, y: camera.y, zoom: camera.zoom };
}

function setCamera(snapshot: { x: number; y: number; zoom: number }): void {
  camera.x = snapshot.x;
  camera.y = snapshot.y;
  camera.zoom = snapshot.zoom;
  refreshPointerWorld();
}

function coordinateLabel(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

function teleport(point: Point, options: TeleportOptions, target: string, objectId?: string): void {
  const before = cameraSnapshot();
  const after = { ...before, x: point.x, y: point.y };

  if (options.record === false) {
    setCamera(after);
    if (objectId) selectOnly(objectId);
    return;
  }

  let firstRun = true;
  execute({
    label: options.label,
    target,
    do: () => {
      setCamera(after);
      if (objectId) selectOnly(objectId);
      if (firstRun) {
        pushNavigation(before, after);
        firstRun = false;
      } else pointNavigationAt(after);
    },
    undo: () => {
      setCamera(before);
      pointNavigationAt(before);
    },
  });
}

/** Centre the camera on a board point (zoom unchanged). */
export function teleportToPoint(point: Point, options: TeleportOptions): void {
  teleport(point, options, `${coordinateLabel(point.x)}, ${coordinateLabel(point.y)}`);
}

/** Centre the camera on an object and select it. Returns false if the object doesn't exist. */
export function teleportToObject(objectId: string, options: TeleportOptions): boolean {
  const note = board.notes[objectId];
  if (!note) return false;

  const bounds = noteBounds(note);
  teleport(
    { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    options,
    note.name,
    objectId,
  );
  return true;
}

function runNavigationBack(): void {
  const snapshot = navigateBack();
  if (snapshot) setCamera(snapshot);
}

function runNavigationForward(): void {
  const snapshot = navigateForward();
  if (snapshot) setCamera(snapshot);
}

registerCommand({
  id: "navigation.back",
  label: "Navigate Back",
  keys: ["Alt+ArrowLeft"],
  run: runNavigationBack,
  isActive: canNavigateBack,
});

registerCommand({
  id: "navigation.forward",
  label: "Navigate Forward",
  keys: ["Alt+ArrowRight"],
  run: runNavigationForward,
  isActive: canNavigateForward,
});
