import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireDisplayBitmap, displayBitmapSize, peekAnyDisplayBitmap, peekCachedDisplayBitmap } from "../src/attachments/displayBitmap";

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
    vi.stubGlobal("createImageBitmap", vi.fn(async (source: unknown) => {
      // Previews are made from a decoded bitmap, decodes from the fetched blob; count decodes only.
      if (!(source instanceof Blob)) return { width: 32, height: 32, close: () => undefined } as ImageBitmap;
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

  it("keeps a small preview of an evicted decode so a returning picture is never empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new Blob() })));
    vi.stubGlobal("createImageBitmap", vi.fn(async (source: unknown, options?: ImageBitmapOptions) => (
      source instanceof Blob
        ? { width: 2000, height: 2000, close: () => undefined }
        : { width: options?.resizeWidth ?? 0, height: options?.resizeHeight ?? 0, close: () => undefined }
    ) as ImageBitmap));

    const first = await acquireDisplayBitmap("test://preview/0", 2000, 2000);
    first.release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Big decodes of other pictures push the first one out of the budgeted cache.
    for (let index = 1; index <= 5; index += 1) (await acquireDisplayBitmap(`test://preview/${index}`, 2000, 2000)).release();

    expect(peekCachedDisplayBitmap("test://preview/0")).toBeUndefined();
    const preview = peekAnyDisplayBitmap("test://preview/0", 400, 400);
    expect(preview?.width).toBe(160);
  });
});
