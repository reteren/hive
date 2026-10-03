import { describe, expect, it, vi } from "vitest";
import { loadFormatText, type FormatTextLoadDependencies } from "../src/formats/formatLoad";

const file = `${"a".repeat(64)}.json`;

describe("desktop Format file loading", () => {
  it("uses the asset URL when it can be fetched", async () => {
    const deps: FormatTextLoadDependencies = {
      fetchBytes: vi.fn(async () => new TextEncoder().encode("\ufeff{\"ok\":true}\r\n")),
      attachmentDirectory: vi.fn(async () => "C:\\project\\attachments"),
      readDroppedText: vi.fn(async () => "unused"),
    };
    expect(await loadFormatText(file, "asset://file", deps)).toEqual({
      text: "{\"ok\":true}\n", encoding: { bom: true, lineEnding: "\r\n" }, byteLength: 16,
    });
    expect(deps.readDroppedText).not.toHaveBeenCalled();
  });

  it("reads the absolute attachment path through Rust when asset fetch is blocked", async () => {
    const deps: FormatTextLoadDependencies = {
      fetchBytes: vi.fn(async () => { throw new Error("Failed to fetch"); }),
      attachmentDirectory: vi.fn(async () => "C:\\project\\attachments\\"),
      readDroppedText: vi.fn(async () => "one\r\ntwo\r\n"),
    };
    expect(await loadFormatText(file, "asset://blocked", deps)).toMatchObject({
      text: "one\ntwo\n", encoding: { bom: false, lineEnding: "\r\n" },
    });
    expect(deps.readDroppedText).toHaveBeenCalledWith(`C:\\project\\attachments\\${file}`);
  });

  it("reports the real failures instead of an empty error box", async () => {
    const deps: FormatTextLoadDependencies = {
      fetchBytes: vi.fn(async () => { throw new Error("CSP blocked asset URL"); }),
      attachmentDirectory: vi.fn(async () => "C:\\project\\attachments"),
      readDroppedText: vi.fn(async () => { throw new Error("File not found"); }),
    };
    await expect(loadFormatText(file, "asset://blocked", deps))
      .rejects.toThrow(/Could not load file: File not found \(asset URL: CSP blocked asset URL\)/);
    await expect(loadFormatText("../board.json", "asset://blocked", deps))
      .rejects.toThrow("Could not load file: invalid attachment name");
  });
});
