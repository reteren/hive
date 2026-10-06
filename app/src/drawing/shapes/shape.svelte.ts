import { camera } from "../../board/camera.svelte";
import { PX_PER_UNIT } from "../../board/cameraMath";
import { drawingSelection } from "../selection.svelte";
import { affectedTileKeys, applyAcrossLevels, pushDrawingHistory, rasterRectToWorld } from "../history";
import { drawingStore } from "../tileStore.svelte";
import { registerDrawTool } from "../toolRegistry";
import type { DrawPointerEvent, DrawToolHandler } from "../types";
import { currentDrawLevel } from "../types";
import { drawingTools } from "../tools.svelte";
import { editShapeDraft, shapeCenter, shapeDraftFromDrag, shapeSize, worldToLocal, type ShapeDraft, type ShapePoint } from "./shapeGeometry";
import { rasterizeShape } from "./rasterize";
import { shapeSettings, shapeUi } from "./state.svelte";

type Gesture =
  | { kind: "create"; start: ShapePoint; shape: ShapeDraft["kind"] }
  | { kind: "move"; startDraft: ShapeDraft; startLocal: ShapePoint }
  | { kind: "resize"; startDraft: ShapeDraft; startLocal: ShapePoint; handle: number }
  | { kind: "rotate"; startDraft: ShapeDraft; startAngle: number };

let gesture: Gesture | null = null;
let ignorePointerUp = false;

export const shapeToolHandler: DrawToolHandler = {
  down(event) {
    if (shapeUi.committing) return;
    shapeUi.error = "";
    const draft = shapeUi.draft;
    if (draft) {
      const action = hitTest(draft, event);
      if (!action) {
        ignorePointerUp = true;
        void commitShape();
        return;
      }
      const local = worldToLocal(event.world, draft);
      if (action.kind === "rotate") {
        const center = shapeCenter(draft);
        gesture = { kind: "rotate", startDraft: { ...draft }, startAngle: Math.atan2(event.world.y - center.y, event.world.x - center.x) };
      } else if (action.kind === "resize") {
        gesture = { kind: "resize", startDraft: { ...draft }, startLocal: local, handle: action.handle };
      } else {
        gesture = { kind: "move", startDraft: { ...draft }, startLocal: local };
      }
      return;
    }
    gesture = { kind: "create", start: { ...event.world }, shape: shapeSettings.kind };
    shapeUi.draft = shapeDraftFromDrag(shapeSettings.kind, event.world, event.world, event);
  },

  move(event) {
    if (ignorePointerUp) return;
    if (!gesture) return;
    if (gesture.kind === "create") {
      shapeUi.draft = shapeDraftFromDrag(gesture.shape, gesture.start, event.world, event);
      return;
    }
    const startDraft = gesture.startDraft;
    if (gesture.kind === "move") {
      shapeUi.draft = editShapeDraft(startDraft, worldToLocal(event.world, startDraft), { kind: "move" }, startDraft, gesture.startLocal);
    } else if (gesture.kind === "resize") {
      shapeUi.draft = editShapeDraft(startDraft, worldToLocal(event.world, startDraft), { kind: "resize", handle: gesture.handle }, startDraft, gesture.startLocal);
    } else {
      const center = shapeCenter(startDraft);
      const angle = Math.atan2(event.world.y - center.y, event.world.x - center.x);
      shapeUi.draft = { ...startDraft, rotation: startDraft.rotation + angle - gesture.startAngle };
    }
  },

  up(event) {
    if (ignorePointerUp) {
      ignorePointerUp = false;
      gesture = null;
      return;
    }
    if (!gesture) return;
    this.move(event);
    gesture = null;
    const size = shapeUi.draft ? shapeSize(shapeUi.draft) : null;
    const pixelsPerWorld = camera.zoom * PX_PER_UNIT;
    if (!shapeUi.draft || !size || (size.width * pixelsPerWorld < 0.5 && size.height * pixelsPerWorld < 0.5)) shapeUi.draft = null;
  },

  cancel() {
    gesture = null;
    ignorePointerUp = false;
    if (!shapeUi.committing) shapeUi.draft = null;
  },

  deactivate() {
    gesture = null;
    ignorePointerUp = false;
    if (!shapeUi.committing) shapeUi.draft = null;
  },

  key(event) {
    if (event.code === "Enter" && shapeUi.draft) {
      void commitShape();
      return true;
    }
    if (event.code === "Escape" && (shapeUi.draft || gesture)) {
      this.cancel();
      return true;
    }
    return false;
  },
};

registerDrawTool("shape", shapeToolHandler);

async function commitShape(): Promise<void> {
  const draft = shapeUi.draft;
  if (!draft || shapeUi.committing) return;
  shapeUi.committing = true;
  shapeUi.error = "";
  shapeUi.draft = null;
  const brush = { ...drawingTools.brush };
  const settings = { ...shapeSettings };
  const zoom = camera.zoom;
  const level = currentDrawLevel(zoom);
  try {
    const raster = rasterizeShape(draft, {
      brush,
      zoom,
      level,
      fillMode: settings.fillMode,
      polygonSides: settings.polygonSides,
      cornerRadius: settings.cornerRadius,
    });
    const rect = rasterRectToWorld(raster.rasterX, raster.rasterY, raster.canvas.width, raster.canvas.height, raster.level);
    const beforeKeys = affectedTileKeys(rect, raster.level, "paint");
    const before = await drawingStore.snapshot(beforeKeys);
    const changed = applyAcrossLevels(raster.canvas, raster.rasterX, raster.rasterY, raster.level, "paint", 1, drawingSelection.area);
    if (changed.length > 0) pushDrawingHistory("Shape", before, changed);
  } catch (error) {
    shapeUi.error = error instanceof Error ? error.message : "The shape could not be committed.";
    if (drawingTools.active === "shape") shapeUi.draft = { ...draft };
  } finally {
    shapeUi.committing = false;
  }
}

type HitAction = { kind: "move" } | { kind: "resize"; handle: number } | { kind: "rotate" };

function hitTest(draft: ShapeDraft, event: DrawPointerEvent): HitAction | null {
  const scale = Math.max(0.05, event.zoom) * PX_PER_UNIT;
  const tolerance = 10 / scale;
  const center = shapeCenter(draft);
  const width = Math.max(draft.right - draft.left, 12 / scale);
  const height = Math.max(draft.bottom - draft.top, 12 / scale);
  const rotateLocal = { x: center.x, y: center.y - height / 2 - 20 / scale };
  const rotatePoint = rotateAround(rotateLocal, center, draft.rotation);
  if (distance(rotatePoint, event.world) <= tolerance) return { kind: "rotate" };
  const corners = framePoints(draft, width, height);
  for (let index = 0; index < corners.length; index += 1) {
    if (distance(corners[index]!, event.world) <= tolerance) return { kind: "resize", handle: index };
  }
  const local = worldToLocal(event.world, draft);
  if (Math.abs(local.x - center.x) <= width / 2 && Math.abs(local.y - center.y) <= height / 2) return { kind: "move" };
  return null;
}

function framePoints(draft: ShapeDraft, width: number, height: number): ShapePoint[] {
  const center = shapeCenter(draft);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  return [
    { x: center.x - halfWidth, y: center.y - halfHeight },
    { x: center.x, y: center.y - halfHeight },
    { x: center.x + halfWidth, y: center.y - halfHeight },
    { x: center.x + halfWidth, y: center.y },
    { x: center.x + halfWidth, y: center.y + halfHeight },
    { x: center.x, y: center.y + halfHeight },
    { x: center.x - halfWidth, y: center.y + halfHeight },
    { x: center.x - halfWidth, y: center.y },
  ].map((point) => rotateAround(point, center, draft.rotation));
}

function rotateAround(point: ShapePoint, center: ShapePoint, angle: number): ShapePoint {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return { x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
}

function distance(a: ShapePoint, b: ShapePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
