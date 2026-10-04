import { describe, expect, it } from "vitest";
import { layoutTextRaster, textFontSizeAtLevel, textRasterOrigin, textRasterRect } from "../src/drawing/textLayout";

describe("drawing text raster layout", () => {
  it("maps screen brush size to raster pixels for the active level and zoom", () => {
    expect(textFontSizeAtLevel(20, 1, 1)).toBe(20);
    expect(textFontSizeAtLevel(20, 2, 1)).toBe(10);
    expect(textFontSizeAtLevel(10, 1, 0)).toBe(20);
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

  it("normalizes line endings and ignores invalid measurements", () => {
    const layout = layoutTextRaster("one\r\ntwo\rthree", Number.NaN, (line) => line === "two" ? Number.NaN : 7);
    expect(layout.lines).toEqual(["one", "two", "three"]);
    expect(layout.width).toBe(9);
    expect(layout.height).toBe(4);
    expect(layout.fontSize).toBe(1);
  });
});
