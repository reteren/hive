import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset:${path}`),
  invoke: vi.fn(),
  isTauri: () => false,
}));

import {
  attachmentUrl,
  importMediaFile,
  mediaKindForFile,
  mediaKindForPath,
  saveTextAttachment,
} from "../src/attachments/service";

afterEach(() => vi.unstubAllGlobals());

describe("media attachment service in browser preview", () => {
  it.each([
    ["paper.pdf", "application/pdf", ascii("%PDF-1.7\ncontent"), "pdf", "application/pdf"],
    ["source.py", "text/x-python", utf8("print('hello')\n"), "text", "text/plain"],
    ["sound.mp3", "audio/mpeg", new Uint8Array([0x49, 0x44, 0x33, 4, 5, 6]), "audio", "audio/mpeg"],
    ["sound.wav", "audio/wav", ascii("RIFF0000WAVEdata"), "audio", "audio/wav"],
    ["sound.ogg", "audio/ogg", ascii("OggS\x00audio"), "audio", "audio/ogg"],
    ["sound.flac", "audio/flac", ascii("fLaCdata"), "audio", "audio/flac"],
    ["sound.m4a", "audio/mp4", mp4("M4A "), "audio", "audio/mp4"],
    ["clip.mp4", "video/mp4", mp4("isom"), "video", "video/mp4"],
    ["clip.webm", "video/webm", ebml(), "video", "video/webm"],
    ["voice.webm", "audio/webm", ebml(), "audio", "audio/webm"],
  ] as const)("imports %s with verified kind and MIME", async (name, type, bytes, kind, mime) => {
    const file = makeFile(name, type, bytes);

    const result = await importMediaFile(file);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.media).toMatchObject({
      file: name,
      kind,
      mime,
      size: bytes.length,
      name,
    });
    const url = attachmentUrl(result.media.file);
    expect(url).toMatch(/^blob:/);
    expect(new Uint8Array(await (await fetch(url)).arrayBuffer())).toEqual(bytes);
  });

  it("uses path extensions for synchronous drop routing", () => {
    expect(mediaKindForPath("C:\\inbox\\paper.PDF")).toBe("pdf");
    expect(mediaKindForPath("C:\\inbox\\task.py")).toBe("text");
    expect(mediaKindForPath("clip.mp4")).toBe("video");
    expect(mediaKindForPath("unknown.bin")).toBeNull();
    expect(mediaKindForFile(makeFile("voice.webm", "audio/webm", ebml()))).toBe("audio");
  });

  it("rejects text with invalid UTF-8 and applies the size cap before reading", async () => {
    const invalidText = await importMediaFile(makeFile("broken.json", "application/json", new Uint8Array([0xc3, 0x28])));
    expect(invalidText).toEqual({ ok: false, error: "Text files must be valid UTF-8." });

    const read = vi.fn(async () => new ArrayBuffer(0));
    const oversized = { ...makeFile("large.pdf", "application/pdf", new Uint8Array()), size: 200 * 1024 * 1024 + 1, arrayBuffer: read } as File;
    const tooLarge = await importMediaFile(oversized);
    expect(tooLarge).toEqual({ ok: false, error: "File exceeds the 200 MB limit." });
    expect(read).not.toHaveBeenCalled();
  });

  it("saves edited text as a new readable attachment", async () => {
    const previous = {
      file: `${"a".repeat(64)}.md`,
      mime: "text/plain",
      size: 3,
      name: "notes.md",
      kind: "text" as const,
    };

    const result = await saveTextAttachment("updated\n", previous);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.media).toMatchObject({ kind: "text", name: "notes.md", mime: "text/plain" });
    expect(result.media.file).not.toBe(previous.file);
    expect(new Uint8Array(await (await fetch(attachmentUrl(result.media.file))).arrayBuffer())).toEqual(utf8("updated\n"));
  });

  it("rejects large browser video before reading it into memory", async () => {
    const read = vi.fn(async () => new ArrayBuffer(0));
    const large = { ...makeFile("large.mp4", "video/mp4", new Uint8Array()), size: 20 * 1024 * 1024 + 1, arrayBuffer: read } as File;
    expect(await importMediaFile(large)).toMatchObject({ ok: false, error: expect.stringContaining("file path") });
    expect(read).not.toHaveBeenCalled();
  });
});

function makeFile(name: string, type: string, bytes: Uint8Array): File {
  return { name, type, size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer } as File;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function ascii(value: string): Uint8Array {
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

function mp4(brand: string): Uint8Array {
  return ascii(`\x00\x00\x00\x18ftyp${brand}\x00\x00\x00\x00`);
}

function ebml(): Uint8Array {
  return new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x86]);
}
