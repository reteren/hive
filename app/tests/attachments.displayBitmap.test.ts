import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireDisplayBitmap, displayBitmapSize } from "../src/attachments/displayBitmap";

afterEach(() => vi.unstubAllGlobals());

describe("displayBitmapSize", () => {
  it("caps the decoded copy to twice the displayed pixel size", () => {
    const size = displayBitmapSize(4000, 2000, 600, 300, 1);
    expect(size.width).toBeLessThanOrEqual(1200);
    expect(size.height).toBeLessThanOrEqual(600);
    expect(size.width / size.height).toBeCloseTo(2, 1);
  });

  it("uses the original dimensions when the image is small on screen", () => {
    expect(displayBitmapSize(640, 320, 800, 400, 1)).toEqual({ width: 640, height: 320 });
  });

  it("returns no decode size for unknown dimensions", () => {
    expect(displayBitmapSize(0, 100, 100, 100, 1)).toEqual({ width: 0, height: 0 });
  });

  it("releases the oldest cached decode after the entry limit is crossed", async () => {
    const closed: string[] = [];
    const created: ImageBitmap[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new Blob() })));
    vi.stubGlobal("createImageBitmap", vi.fn(async () => {
      const index = created.length;
      const bitmap = { width: 64, height: 64, close: () => closed.push(String(index)) } as ImageBitmap;
      created.push(bitmap);
      return bitmap;
    }));

    for (let index = 0; index < 97; index += 1) {
      const lease = await acquireDisplayBitmap(`test://display/${index}`, 64, 64);
      lease.release();
    }

    expect(created).toHaveLength(97);
    expect(closed).toHaveLength(1);
    expect(created[0]?.width).toBe(64);
  });
});
