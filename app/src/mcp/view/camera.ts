import { beginTransientCameraChange, camera as boardCamera, cameraSettings, refreshPointerWorld, viewport as boardViewport } from "../../board/camera.svelte";
import { PX_PER_UNIT, type Camera, type Size } from "../../board/cameraMath";
import { McpError } from "../registry";

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CameraCapture {
  bbox: BBox;
  zoom: number;
}

/** Temporarily fit the requested board area and restore the precise prior camera on every exit. */
export async function withCameraFit<T>(
  target: BBox | null,
  operation: (capture: CameraCapture) => Promise<T>,
  camera: Camera = boardCamera,
  viewport: Size = boardViewport,
  refresh = refreshPointerWorld,
): Promise<T> {
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) {
    throw new McpError("unsupported", "The board viewport is not ready yet. Wait for the board to finish opening, then retry.");
  }

  const previous = { x: camera.x, y: camera.y, zoom: camera.zoom };
  const endTransientChange = beginTransientCameraChange();
  try {
    if (target) {
      const availableWidth = viewport.width * 0.84;
      const availableHeight = viewport.height * 0.84;
      const widthZoom = target.width > 0 ? availableWidth / (target.width * PX_PER_UNIT) : Number.POSITIVE_INFINITY;
      const heightZoom = target.height > 0 ? availableHeight / (target.height * PX_PER_UNIT) : Number.POSITIVE_INFINITY;
      const fitZoom = Math.min(widthZoom, heightZoom);
      const zoom = Math.min(cameraSettings.maxZoom, Math.max(cameraSettings.minZoom,
        Number.isFinite(fitZoom) ? fitZoom : cameraSettings.maxZoom));
      camera.x = target.x + target.width / 2;
      camera.y = target.y + target.height / 2;
      camera.zoom = zoom;
      refresh();
    }

    const scale = PX_PER_UNIT * camera.zoom;
    const bbox = {
      x: camera.x - viewport.width / scale / 2,
      y: camera.y - viewport.height / scale / 2,
      width: viewport.width / scale,
      height: viewport.height / scale,
    };
    return await operation({ bbox, zoom: camera.zoom });
  } finally {
    try {
      camera.x = previous.x;
      camera.y = previous.y;
      camera.zoom = previous.zoom;
      refresh();
    } finally {
      endTransientChange();
    }
  }
}
