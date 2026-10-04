import { showLinkStatus } from "../links-in-text/contextMenu.svelte";
import { camera } from "../board/camera.svelte";
import { drawingSelection } from "./selection.svelte";
import { drawingStore } from "./tileStore.svelte";
import { drawingTools } from "./tools.svelte";
import { affectedTileKeys, applyAcrossLevels, pushDrawingHistory, rasterRectToWorld } from "./history";
import { registerDrawTool } from "./toolRegistry";
import { currentDrawLevel, type DrawPointerEvent, type DrawToolHandler } from "./types";
import { layoutTextRaster, textFontSizeAtLevel, textRasterRect } from "./textLayout";

const UI_FONT = "system-ui, sans-serif";

/** Scalar rune fields avoid proxying/replacing session objects while the editor is open. */
export const textEditor = $state({
  active: false,
  sessionId: 0,
  value: "",
  worldX: 0,
  worldY: 0,
});

interface TextCommit {
  text: string;
  worldX: number;
  worldY: number;
  zoom: number;
  settings: { color: string; size: number; opacity: number };
  selection: typeof drawingSelection.area;
}

let commitQueue = Promise.resolve();

function beginText(event: DrawPointerEvent): void {
  // Finish the previous insertion before opening an editor at the new click.
  commitTextEditor();
  textEditor.sessionId += 1;
  textEditor.value = "";
  textEditor.worldX = event.world.x;
  textEditor.worldY = event.world.y;
  textEditor.active = true;
}

export function updateTextEditor(sessionId: number, value: string): void {
  if (!textEditor.active || textEditor.sessionId !== sessionId) return;
  textEditor.value = value;
}

/** Commit only the editor instance that requested it, so a stale blur cannot close a new one. */
export function commitTextEditor(sessionId = textEditor.sessionId): void {
  if (!textEditor.active || textEditor.sessionId !== sessionId) return;
  const text = textEditor.value;
  const commit: TextCommit = {
    text,
    worldX: textEditor.worldX,
    worldY: textEditor.worldY,
    zoom: camera.zoom,
    settings: {
      color: drawingTools.brush.color,
      size: drawingTools.brush.size,
      opacity: drawingTools.brush.opacity,
    },
    selection: drawingSelection.area,
  };
  textEditor.active = false;
  textEditor.value = "";
  if (!text.trim()) return;

  commitQueue = commitQueue.then(() => commitRasterText(commit)).catch((error: unknown) => {
    showLinkStatus(error instanceof Error ? error.message : String(error));
  });
}

export function cancelTextEditor(sessionId = textEditor.sessionId): void {
  if (!textEditor.active || textEditor.sessionId !== sessionId) return;
  textEditor.active = false;
  textEditor.value = "";
}

async function commitRasterText(commit: TextCommit): Promise<void> {
  const level = currentDrawLevel(commit.zoom);
  const fontSize = textFontSizeAtLevel(commit.settings.size, commit.zoom, level);
  const canvas = document.createElement("canvas");
  const measureContext = canvas.getContext("2d");
  if (!measureContext) throw new Error("Could not create the text drawing canvas.");
  measureContext.font = `${fontSize}px ${UI_FONT}`;
  const layout = layoutTextRaster(commit.text, fontSize, (line) => measureContext.measureText(line).width);
  canvas.width = layout.width;
  canvas.height = layout.height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create the text drawing canvas.");
  context.font = `${layout.fontSize}px ${UI_FONT}`;
  context.textAlign = "left";
  context.textBaseline = "top";
  context.fillStyle = commit.settings.color;
  layout.lines.forEach((line, index) => context.fillText(line, 0, index * layout.lineHeight));

  const rasterRect = textRasterRect(commit.worldX, commit.worldY, level, layout);
  const rect = rasterRectToWorld(rasterRect.x, rasterRect.y, rasterRect.width, rasterRect.height, level);
  const beforeKeys = affectedTileKeys(rect, level, "paint");
  const before = await drawingStore.snapshot(beforeKeys);
  const touched = applyAcrossLevels(
    canvas,
    rasterRect.x,
    rasterRect.y,
    level,
    "paint",
    commit.settings.opacity,
    commit.selection,
  );
  if (touched.length === 0) return;
  const after = await drawingStore.snapshot(beforeKeys);
  pushDrawingHistory("Text", before, after);
}

const textToolHandler: DrawToolHandler = {
  down: beginText,
  move() {},
  up() {},
  // A pointer cancellation after a click should not cancel the text editor; Esc is explicit.
  cancel() {},
  key(event) {
    if (event.code !== "Escape" || event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return false;
    cancelTextEditor();
    return true;
  },
  deactivate() {
    commitTextEditor();
  },
};

export const unregisterTextTool = registerDrawTool("text", textToolHandler);
