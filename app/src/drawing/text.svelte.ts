import { showLinkStatus } from "../links-in-text/contextMenu.svelte";
import { drawingSelection } from "./selection.svelte";
import { drawingStore } from "./tileStore.svelte";
import { drawingTools } from "./tools.svelte";
import { affectedTileKeys, applyAcrossLevels, pushDrawingHistory, rasterRectToWorld } from "./history";
import { registerDrawTool } from "./toolRegistry";
import { currentDrawLevel, levelPxPerUnit, type DrawPointerEvent, type DrawToolHandler } from "./types";
import { layoutTextRaster, textFontSizeAtLevel, textRasterOrigin, textRasterRectAtOrigin, textWorldSizeAtZoom } from "./textLayout";

const UI_FONT = "system-ui, sans-serif";

/** Scalar rune fields avoid proxying/replacing session objects while the editor is open. */
export const textEditor = $state({
  active: false,
  sessionId: 0,
  value: "",
  worldX: 0,
  worldY: 0,
  rasterX: 0,
  rasterY: 0,
  level: 0,
  fontSizeWorld: 1,
});

interface TextCommit {
  text: string;
  rasterX: number;
  rasterY: number;
  level: number;
  fontSizeWorld: number;
  settings: { color: string; opacity: number };
  selection: typeof drawingSelection.area;
}

let commitQueue = Promise.resolve();

function beginText(event: DrawPointerEvent): void {
  // Finish the previous insertion before opening an editor at the new click.
  commitTextEditor();
  const level = currentDrawLevel(event.zoom);
  const rasterOrigin = textRasterOrigin(event.world.x, event.world.y, level);
  const pixelsPerUnit = levelPxPerUnit(level);
  textEditor.sessionId += 1;
  textEditor.value = "";
  // Snap both the editor and the eventual canvas origin to the same raster pixel to avoid a jump.
  textEditor.rasterX = rasterOrigin.x;
  textEditor.rasterY = rasterOrigin.y;
  textEditor.worldX = rasterOrigin.x / pixelsPerUnit;
  textEditor.worldY = rasterOrigin.y / pixelsPerUnit;
  textEditor.level = level;
  textEditor.fontSizeWorld = textWorldSizeAtZoom(drawingTools.brush.size, event.zoom);
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
    rasterX: textEditor.rasterX,
    rasterY: textEditor.rasterY,
    level: textEditor.level,
    fontSizeWorld: textEditor.fontSizeWorld,
    settings: {
      color: drawingTools.brush.color,
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
  const level = commit.level;
  const fontSize = textFontSizeAtLevel(commit.fontSizeWorld, level);
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

  const rasterRect = textRasterRectAtOrigin(commit.rasterX, commit.rasterY, layout);
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
