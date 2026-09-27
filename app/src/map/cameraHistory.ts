import { camera, refreshPointerWorld } from "../board/camera.svelte";
import { record } from "../history/history.svelte";
import { pointNavigationAt, pushNavigation } from "../navigation/navigationHistory.svelte";

export interface CameraSnapshot {
  x: number;
  y: number;
  zoom: number;
}

export function cameraSnapshot(): CameraSnapshot {
  return { x: camera.x, y: camera.y, zoom: camera.zoom };
}

export function restoreCamera(snapshot: CameraSnapshot): void {
  camera.x = snapshot.x;
  camera.y = snapshot.y;
  camera.zoom = snapshot.zoom;
  refreshPointerWorld();
}

/** Record a camera gesture after its live movement has already been applied. */
export function recordMapCameraChange(before: CameraSnapshot, label: string): void {
  const after = cameraSnapshot();
  if (before.x === after.x && before.y === after.y && before.zoom === after.zoom) return;

  pushNavigation(before, after);
  record({
    label,
    target: "Map",
    do: () => {
      restoreCamera(after);
      pointNavigationAt(after);
    },
    undo: () => {
      restoreCamera(before);
      pointNavigationAt(before);
    },
  });
}
