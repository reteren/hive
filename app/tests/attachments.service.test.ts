import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset:${path}`),
  invoke: vi.fn(),
  isTauri: () => false,
}));

import {
  attachmentUrl,
  dispatchFileDrop,
  importImageFile,
  registerFileDropHandler,
} from "../src/attachments/service";

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const cleanup: (() => void)[] = [];

afterEach(() => {
  while (cleanup.length) cleanup.pop()?.();
  vi.unstubAllGlobals();
});

describe("attachment service browser fallback", () => {
  it("stores image bytes behind a reusable object URL and returns their intrinsic size", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 640, height: 480, close: vi.fn() })));
    const file = makeFile("clipboard.png", "", pngBytes);

    const first = await importImageFile(file);
    const second = await importImageFile(file);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.image).toEqual({
      file: "clipboard.png",
      mime: "image/png",
      size: pngBytes.length,
      name: "clipboard.png",
      naturalWidth: 640,
      naturalHeight: 480,
    });
    const url = attachmentUrl(first.image.file);
    expect(url).toMatch(/^blob:/);
    expect(attachmentUrl(second.image.file)).toBe(url);
    const response = await fetch(url);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pngBytes);
    URL.revokeObjectURL(url);
  });

  it("dispatches file drops by descending priority until a handler accepts", () => {
    const called: string[] = [];
    cleanup.push(registerFileDropHandler(0, () => { called.push("fallback"); return true; }));
    cleanup.push(registerFileDropHandler(30, () => { called.push("tier"); return false; }));
    cleanup.push(registerFileDropHandler(20, () => { called.push("inline"); return true; }));

    expect(dispatchFileDrop(["photo.png"], null, { x: 12, y: 34 })).toBe(true);
    expect(called).toEqual(["tier", "inline"]);
  });

  it("rejects unknown bytes even when the display name has a supported extension", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn());
    const result = await importImageFile(makeFile("not-image.png", "image/png", new Uint8Array([1, 2, 3])));
    expect(result.ok).toBe(false);
  });
});

function makeFile(name: string, type: string, bytes: Uint8Array): File {
  return {
    name,
    type,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.slice().buffer,
  } as File;
}
