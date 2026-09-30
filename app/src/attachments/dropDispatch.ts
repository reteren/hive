import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { dispatchFileDrop } from "./service";

let started = false;

/** Install the one native file-drop listener shared by image, inline and Tierlist consumers. */
export function initializeFileDropDispatch(): void {
  if (started || !isTauri()) return;
  started = true;

  try {
    void getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return;
      const point = event.payload.position.toLogical(window.devicePixelRatio);
      dispatchFileDrop(
        event.payload.paths,
        document.elementFromPoint(point.x, point.y),
        { x: point.x, y: point.y },
      );
    }).catch((error: unknown) => {
      started = false;
      console.error("Could not start file drop handling", error);
    });
  } catch (error) {
    started = false;
    console.error("Could not start file drop handling", error);
  }
}
