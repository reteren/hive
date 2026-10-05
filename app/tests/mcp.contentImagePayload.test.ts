import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/attachments/service", () => ({
  attachmentUrl: (file: string) => `asset://${file}`,
}));

import {
  attachmentImagePayload,
  enforceImagePayloadBudget,
  type ImagePayload,
} from "../src/mcp/content/imagePayload";

afterEach(() => vi.unstubAllGlobals());

describe("MCP image payloads", () => {
  it("drops the largest images first to keep the call within budget", () => {
    const small = payload("small.png", 12);
    const large = payload("large.png", 24);
    const result = { inlineImages: [small, large] };

    const omitted = enforceImagePayloadBudget(result, 12);

    expect(result.inlineImages).toEqual([small]);
    expect(omitted).toEqual([{ file: "large.png", reason: expect.stringContaining("6 MiB") }]);
  });

  it("scales GIFs to the requested bound and marks the returned first frame", async () => {
    const bitmap = { width: 3000, height: 1500, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["gif"], { type: "image/gif" }), { status: 200 })));
    vi.stubGlobal("document", { createElement: () => canvasMock(255) });

    const image = await attachmentImagePayload({ file: "loop.gif", mime: "image/gif" }, 1024);

    expect(image).toMatchObject({
      file: "loop.gif",
      mime: "image/jpeg",
      width: 1024,
      height: 512,
      originalWidth: 3000,
      originalHeight: 1500,
      animated: true,
    });
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it("uses PNG when a converted image retains transparent pixels", async () => {
    const bitmap = { width: 2, height: 2, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["png"], { type: "image/png" }), { status: 200 })));
    vi.stubGlobal("document", { createElement: () => canvasMock(0) });

    const image = await attachmentImagePayload({ file: "transparent.png", mime: "image/png" }, 256);

    expect(image.mime).toBe("image/png");
  });
});

function payload(file: string, bytes: number): ImagePayload {
  return {
    file,
    mime: "image/jpeg",
    data: "A".repeat(Math.ceil(bytes * 4 / 3)),
    width: 1,
    height: 1,
    originalWidth: 1,
    originalHeight: 1,
  };
}

function canvasMock(alpha: number): HTMLCanvasElement {
  let width = 0;
  let height = 0;
  const context = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => {
      const data = new Uint8ClampedArray(width * height * 4).fill(255);
      for (let index = 3; index < data.length; index += 4) data[index] = alpha;
      return { data };
    }),
  };
  return {
    get width() { return width; },
    set width(value: number) { width = value; },
    get height() { return height; },
    set height(value: number) { height = value; },
    getContext: vi.fn(() => context),
    toBlob: (callback: BlobCallback, type?: string) => callback(new Blob(["pixels"], { type })),
  } as unknown as HTMLCanvasElement;
}
