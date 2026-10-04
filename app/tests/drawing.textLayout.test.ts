import { describe, expect, it } from "vitest";
import { layoutTextRaster, textFontSizeAtLevel, textRasterOrigin, textRasterRect, textRasterRectAtOrigin, textScreenSizeAtZoom, textWorldSizeAtZoom } from "../src/drawing/textLayout";
import { levelPxPerUnit } from "../src/drawing/types";

describe("drawing text raster layout", () => {
  it("locks text size in world units at the insertion zoom and scales the editor with the camera", () => {
    const worldSize = textWorldSizeAtZoom(24, 1.5);
    expect(worldSize).toBe(1.6);
    expect(textScreenSizeAtZoom(worldSize, 1.5)).toBeCloseTo(24);
    expect(textScreenSizeAtZoom(worldSize, 3)).toBeCloseTo(48);
    expect(textFontSizeAtLevel(worldSize, 1) / levelPxPerUnit(1)).toBeCloseTo(worldSize);
  });

  it("places the text origin at the floored raster coordinate, including negative board points", () => {
    expect(textRasterOrigin(1.24, -0.02, 1)).toEqual({ x: 12, y: -1 });
  });

  it("sizes multiline text from measured line widths and font leading", () => {
    const layout = layoutTextRaster("wide\n\nshort", 10, (line) => line.length * 5.25);
    expect(layout).toEqual({
      lines: ["wide", "", "short"],
      width: 29,
      height: 36,
      lineHeight: 12,
      fontSize: 10,
    });
    expect(textRasterRect(1.24, -0.02, 1, layout)).toEqual({ x: 12, y: -1, width: 29, height: 36 });
  });

  it("keeps the raster rectangle's glyph bounds at the same world size across levels", () => {
    const worldSize = textWorldSizeAtZoom(32, 2);
    const glyphWorldWidths = [0, 1].map((level) => {
      const fontSize = textFontSizeAtLevel(worldSize, level);
      const layout = layoutTextRaster("XX", fontSize, () => fontSize * 2);
      const rect = textRasterRectAtOrigin(17, -9, layout);
      expect(rect).toMatchObject({ x: 17, y: -9, width: layout.width, height: layout.height });
      return (rect.width - 2) / levelPxPerUnit(level);
    });
    expect(glyphWorldWidths[0]).toBeCloseTo(glyphWorldWidths[1], 8);
    expect(glyphWorldWidths[0]).toBeCloseTo(worldSize * 2, 8);
  });

  it("normalizes line endings and ignores invalid measurements", () => {
    const layout = layoutTextRaster("one\r\ntwo\rthree", Number.NaN, (line) => line === "two" ? Number.NaN : 7);
    expect(layout.lines).toEqual(["one", "two", "three"]);
    expect(layout.width).toBe(9);
    expect(layout.height).toBe(4);
    expect(layout.fontSize).toBe(1);
  });
});
