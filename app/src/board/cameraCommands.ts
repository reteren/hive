import { registerCommand } from "../commands/registry.svelte";
import { camera, cameraSettings, refreshPointerWorld, viewport } from "./camera.svelte";
import { zoomAt } from "./cameraMath";
import { markedBeaconPoint, nextMarkedBeacon, validMarks } from "../beacons/marks.svelte";

const COMMAND_ZOOM_FACTOR = 1.2;

function zoomBy(factor: number): void {
  const zoomed = zoomAt(
    camera,
    viewport,
    { x: viewport.width / 2, y: viewport.height / 2 },
    factor,
    cameraSettings,
  );
  camera.x = zoomed.x;
  camera.y = zoomed.y;
  camera.zoom = zoomed.zoom;
  refreshPointerWorld();
}

registerCommand({
  id: "view.home",
  label: "Home view",
  keys: ["Home"],
  run: () => {
    camera.x = 0;
    camera.y = 0;
    camera.zoom = 1;
    refreshPointerWorld();
  },
});

registerCommand({
  id: "view.nextMarkedBeacon",
  label: "Go to next marked beacon",
  keys: ["Space"],
  run: () => {
    const hasMarks = validMarks().length > 0;
    const point = markedBeaconPoint(nextMarkedBeacon());
    camera.x = point.x;
    camera.y = point.y;
    if (!hasMarks) camera.zoom = 1;
    refreshPointerWorld();
  },
});

registerCommand({
  id: "view.zoomIn",
  label: "Zoom in",
  keys: ["Equal", "NumpadAdd"],
  run: () => zoomBy(COMMAND_ZOOM_FACTOR),
});

registerCommand({
  id: "view.zoomOut",
  label: "Zoom out",
  keys: ["Minus", "NumpadSubtract"],
  run: () => zoomBy(1 / COMMAND_ZOOM_FACTOR),
});

registerCommand({
  id: "view.zoomReset",
  label: "Reset zoom",
  keys: ["Ctrl+Digit0"],
  run: () => {
    camera.zoom = 1;
    refreshPointerWorld();
  },
});
