import { describe, expect, it } from "vitest";
import { clipRasterDataToSelection, selectionCoverageAtRasterPixel, type SelectionClipMask } from "../src/drawing/selectionClip";

function opaquePixels(count: number, color: readonly [number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(count * 4);
  for (let pixel = 0; pixel < count; pixel += 1) {
    data.set([...color, 255], pixel * 4);
  }
  return data;
}

describe("drawing selection clipping", () => {
  it("keeps selected source pixels and leaves pixels outside the mask unchanged", () => {
    const selection: SelectionClipMask = {
      x: 1,
      y: 0,
      width: 2,
      height: 1,
      mask: new Uint8Array([255, 0]),
      level: 0,
    };
    const operation = opaquePixels(4, [255, 0, 0]);
    clipRasterDataToSelection(operation, 4, 1, 0, 0, 0, selection);

    const before = opaquePixels(4, [0, 0, 255]);
    const after = new Uint8ClampedArray(before);
    for (let pixel = 0; pixel < 4; pixel += 1) {
      if (operation[pixel * 4 + 3] === 0) continue;
      after.set(operation.subarray(pixel * 4, pixel * 4 + 4), pixel * 4);
    }

    expect(Array.from(operation.filter((_value, index) => index % 4 === 3))).toEqual([0, 255, 0, 0]);
    expect(Array.from(after.filter((_value, index) => index % 4 === 2))).toEqual([255, 0, 255, 255]);
    expect(Array.from(after.filter((_value, index) => index % 4 === 0))).toEqual([0, 255, 0, 0]);
  });

  it("maps the mask across finer and coarser pyramid levels", () => {
    const selection: SelectionClipMask = {
      x: 0,
      y: 0,
      width: 2,
      height: 2,
      mask: new Uint8Array([255, 0, 255, 0]),
      level: 2,
    };

    expect([0, 1, 2, 3].map((x) => selectionCoverageAtRasterPixel(selection, x, 0, 1)))
      .toEqual([1, 1, 0, 0]);
    expect([0, 1].map((x) => selectionCoverageAtRasterPixel(selection, x, 0, 3)))
      .toEqual([0.5, 0]);
  });
});
