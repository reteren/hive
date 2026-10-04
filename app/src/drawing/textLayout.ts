import { PX_PER_UNIT } from "../board/cameraMath";
import { levelPxPerUnit } from "./types";

export interface TextRasterLayout {
  lines: string[];
  width: number;
  height: number;
  lineHeight: number;
  fontSize: number;
}

export interface TextRasterRect { x: number; y: number; width: number; height: number }

/** Convert the clicked screen-space brush size into a stable board-space text size. */
export function textWorldSizeAtZoom(size: number, zoom: number): number {
  const safeSize = Number.isFinite(size) && size > 0 ? size : 1;
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return safeSize / (PX_PER_UNIT * safeZoom);
}

/** Screen-space preview size for a fixed board-space font size. */
export function textScreenSizeAtZoom(worldSize: number, zoom: number): number {
  const safeSize = Number.isFinite(worldSize) && worldSize > 0 ? worldSize : 1 / PX_PER_UNIT;
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return safeSize * PX_PER_UNIT * safeZoom;
}

/** Raster font size for the fixed board-space font size at a chosen pyramid level. */
export function textFontSizeAtLevel(worldSize: number, level: number): number {
  const safeSize = Number.isFinite(worldSize) && worldSize > 0 ? worldSize : 1 / PX_PER_UNIT;
  return safeSize * levelPxPerUnit(level);
}

/** Raster origin for a text insertion point; floor keeps negative world coordinates consistent. */
export function textRasterOrigin(worldX: number, worldY: number, level: number): { x: number; y: number } {
  const ppu = levelPxPerUnit(level);
  return { x: Math.floor(worldX * ppu), y: Math.floor(worldY * ppu) };
}

/** World insertion point and measured layout combined as a level-specific raster rectangle. */
export function textRasterRect(worldX: number, worldY: number, level: number, layout: TextRasterLayout): TextRasterRect {
  return { ...textRasterOrigin(worldX, worldY, level), width: layout.width, height: layout.height };
}

/** Raster rectangle when the insertion point has already been snapped to a raster origin. */
export function textRasterRectAtOrigin(rasterX: number, rasterY: number, layout: TextRasterLayout): TextRasterRect {
  return { x: rasterX, y: rasterY, width: layout.width, height: layout.height };
}

/** Measure each line in raster pixels and reserve a little leading between baselines. */
export function layoutTextRaster(
  text: string,
  fontSize: number,
  measureLine: (line: string) => number,
): TextRasterLayout {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const safeFontSize = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 1;
  const lineHeight = safeFontSize * 1.2;
  let maxWidth = 0;
  for (const line of lines) {
    const measured = measureLine(line);
    if (Number.isFinite(measured)) maxWidth = Math.max(maxWidth, measured);
  }
  return {
    lines,
    // Two spare pixels keep antialiased edge coverage inside the canvas at the final glyph.
    width: Math.max(1, Math.ceil(maxWidth) + 2),
    height: Math.max(1, Math.ceil(lineHeight * lines.length)),
    lineHeight,
    fontSize: safeFontSize,
  };
}
