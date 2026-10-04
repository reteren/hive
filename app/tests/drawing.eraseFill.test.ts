import { describe, expect, it } from "vitest";
import type { ImageRef } from "../src/attachments/types";
import type { Note } from "../src/model/note";
import {
  DEFAULT_FILL_TOLERANCE,
  FILL_WINDOW_PIXELS,
  fillWindowAt,
  prepareFloodFill,
} from "../src/drawing/fill";
import {
  isErasablePhoto,
  ERASER_GIF_TOOLTIP,
  erasablePhotosInRasterRect,
  eraserCompositeOptions,
  photoEraseGeometry,
  photoIntersectsRasterRect,
  photoMaskTransform,
  worldPointToPhotoPixel,
} from "../src/drawing/photoErase";
import eraserSource from "../src/drawing/eraser.ts?raw";
import "../src/drawing/eraser";
import { drawToolHandler } from "../src/drawing/toolRegistry";

const image: ImageRef = {
  file: `${"a".repeat(64)}.png`,
  mime: "image/png",
  size: 12,
  naturalWidth: 400,
  naturalHeight: 200,
  name: "photo.png",
};

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "image-1",
    type: "image",
    name: "Photo",
    text: "",
    x: 10,
    y: 20,
    width: 20,
    height: 10,
    image,
    ...overrides,
  };
}

function raster(width: number, height: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height * 4);
}

function setPixel(data: Uint8ClampedArray, width: number, x: number, y: number, rgba: readonly [number, number, number, number]): void {
  data.set(rgba, (y * width + x) * 4);
}

function getPixel(data: Uint8ClampedArray, width: number, x: number, y: number): number[] {
  return Array.from(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));
}

function square(data: Uint8ClampedArray, width: number, left: number, top: number, right: number, bottom: number): void {
  for (let x = left; x <= right; x += 1) {
    setPixel(data, width, x, top, [0, 0, 0, 255]);
    setPixel(data, width, x, bottom, [0, 0, 0, 255]);
  }
  for (let y = top; y <= bottom; y += 1) {
    setPixel(data, width, left, y, [0, 0, 0, 255]);
    setPixel(data, width, right, y, [0, 0, 0, 255]);
  }
}

describe("Drawing fill", () => {
  it("registers both erase/fill handlers with the drawing tool registry", () => {
    expect(drawToolHandler("eraser")).toBeDefined();
    expect(drawToolHandler("fill")).toBeDefined();
  });

  it("fills only the interior of a closed transparent region and returns a tight crop", () => {
    const width = 9;
    const height = 9;
    const pixels = raster(width, height);
    square(pixels, width, 1, 1, 7, 7);

    const result = prepareFloodFill(pixels, width, height, 4, 4, {
      color: "#ff0000",
      opacity: 1,
      rasterX: -100,
      rasterY: 500,
    });

    expect(result.status).toBe("filled");
    expect(result.pixelsChanged).toBe(25);
    expect(result.image).toMatchObject({ width: 5, height: 5, rasterX: -98, rasterY: 502 });
    expect(getPixel(result.image!.data, 5, 2, 2)).toEqual([255, 0, 0, 255]);
    expect(getPixel(result.image!.data, 5, 0, 2)).toEqual([255, 0, 0, 255]);
    expect(getPixel(pixels, width, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(getPixel(pixels, width, 1, 3)).toEqual([0, 0, 0, 255]);
  });

  it("does nothing when an open region connects to the fill-window edge", () => {
    const width = 9;
    const height = 9;
    const pixels = raster(width, height);
    square(pixels, width, 1, 1, 7, 7);
    // A missing segment lets the transparent interior connect to the outside.
    setPixel(pixels, width, 7, 4, [0, 0, 0, 0]);

    const result = prepareFloodFill(pixels, width, height, 4, 4, { color: "#00ff00", opacity: 1 });
    expect(result).toEqual({ status: "open", pixelsChanged: 0 });
    expect(getPixel(pixels, width, 4, 4)).toEqual([0, 0, 0, 0]);
  });

  it("uses the default tolerance and fills one pixel beneath antialiased boundaries", () => {
    const width = 9;
    const height = 9;
    const pixels = raster(width, height);
    square(pixels, width, 1, 1, 7, 7);
    for (let y = 2; y <= 6; y += 1) {
      for (let x = 2; x <= 6; x += 1) setPixel(pixels, width, x, y, [100, 100, 100, 255]);
    }
    setPixel(pixels, width, 3, 3, [124, 124, 124, 255]);
    setPixel(pixels, width, 4, 3, [125, 125, 125, 255]);
    setPixel(pixels, width, 1, 3, [0, 0, 0, 128]);

    const result = prepareFloodFill(pixels, width, height, 2, 3, {
      color: "#0000ff",
      opacity: 0.5,
      rasterX: 0,
      rasterY: 0,
    });

    expect(DEFAULT_FILL_TOLERANCE).toBe(24);
    expect(result.status).toBe("filled");
    expect(result.image).toBeDefined();
    // Color 124 is within tolerance, color 125 is outside and remains unchanged.
    expect(getPixel(result.image!.data, result.image!.width, 3 - result.image!.rasterX, 3 - result.image!.rasterY)).toEqual([0, 0, 255, 128]);
    const outsideOffset = ((3 - result.image!.rasterY) * result.image!.width + (4 - result.image!.rasterX)) * 4;
    expect(Array.from(result.image!.data.subarray(outsideOffset, outsideOffset + 4))).toEqual([125, 125, 125, 255]);
    const boundaryX = 1 - result.image!.rasterX;
    const boundaryY = 3 - result.image!.rasterY;
    expect(getPixel(result.image!.data, result.image!.width, boundaryX, boundaryY)[3]).toBeGreaterThan(128);
  });

  it("uses a four-tile bounded window aligned to the raster tile grid", () => {
    expect(FILL_WINDOW_PIXELS).toBe(2048);
    expect(fillWindowAt(0, 0)).toEqual({ x: -1024, y: -1024, width: 2048, height: 2048 });
    expect(Math.abs(fillWindowAt(600, -700).x % 512)).toBe(0);
    expect(Math.abs(fillWindowAt(600, -700).y % 512)).toBe(0);
  });
});

describe("Photo eraser mapping", () => {
  it("maps world points into source pixels with both flips applied", () => {
    const geometry = photoEraseGeometry(note());
    expect(geometry).toMatchObject({ x: 10, y: 20, width: 20, height: 10, naturalWidth: 400, naturalHeight: 200 });
    expect(worldPointToPhotoPixel({ x: 15, y: 22.5 }, geometry!)).toEqual({ x: 100, y: 50 });
    const flipped = photoEraseGeometry(note({ flipX: true, flipY: true }));
    expect(worldPointToPhotoPixel({ x: 15, y: 22.5 }, flipped!)).toEqual({ x: 300, y: 150 });
    expect(worldPointToPhotoPixel({ x: 9, y: 22.5 }, geometry!)).toBeNull();
  });

  it("maps a global-raster mask into natural image pixels, including flips and note scale", () => {
    const geometry = photoEraseGeometry(note({ flipX: true, flipY: true }));
    expect(photoMaskTransform(geometry!, 200, 400)).toEqual({ a: -1, d: -1, e: 400, f: 200 });

    const scaled = photoEraseGeometry(note({ scale: 2 }));
    expect(scaled).toMatchObject({ width: 40, height: 20 });
    expect(photoMaskTransform(scaled!, 200, 400)).toEqual({ a: 0.5, d: 0.5, e: 0, f: 0 });
  });

  it("limits photo erasing to non-GIF image nodes intersecting the stroke", () => {
    expect(isErasablePhoto(note())).toBe(true);
    expect(isErasablePhoto(note({ image: { ...image, mime: "image/gif" } }))).toBe(false);
    expect(isErasablePhoto(note({ type: "note" }))).toBe(false);
    const geometry = photoEraseGeometry(note())!;
    expect(photoIntersectsRasterRect(geometry, { x: 250, y: 450, width: 20, height: 20 })).toBe(true);
    expect(photoIntersectsRasterRect(geometry, { x: 0, y: 0, width: 20, height: 20 })).toBe(false);
    expect(erasablePhotosInRasterRect([
      note(),
      note({ id: "gif", image: { ...image, mime: "image/gif" } }),
      note({ id: "text", type: "note" }),
    ], { x: 250, y: 450, width: 20, height: 20 }).map(({ note: target }) => target.id)).toEqual(["image-1"]);
    expect(eraserCompositeOptions({ color: "#abcdef", size: 12, opacity: 0.35, hardness: 0.5 })).toEqual({
      mode: "destination-out",
      opacity: 1,
    });
    expect(ERASER_GIF_TOOLTIP).toBe("Erases drawings only. Right-click an image → Erase for pictures.");
  });

  it("keeps the drawing eraser independent from image attachments", () => {
    expect(eraserSource).not.toMatch(/erasePhotoCopyOnWrite|rasterMaskTouchesPhoto|board\.notes|updateNote/);
  });
});
