import { describe, expect, it } from "vitest";
import { DEFAULT_RECORDING_FORMAT, encodeRecording, interleavePcm16, normalizeRecordingFormat } from "../src/audio/recordingFormat";
import { DEFAULT_VIEW_SETTINGS, parseViewSettings, serializeViewSettings } from "../src/settings/viewSettings";

describe("recording format", () => {
  it("defaults to MP3 and keeps a saved choice", () => {
    expect(DEFAULT_RECORDING_FORMAT).toBe("mp3");
    expect(DEFAULT_VIEW_SETTINGS.recordingFormat).toBe("mp3");
    for (const format of ["mp3", "ogg", "webm", "wav", "flac"] as const) {
      const saved = serializeViewSettings({ ...DEFAULT_VIEW_SETTINGS, recordingFormat: format });
      expect(parseViewSettings(saved, DEFAULT_VIEW_SETTINGS).recordingFormat).toBe(format);
    }
    for (const invalid of ["aac", "", 3, null]) expect(normalizeRecordingFormat(invalid)).toBe("mp3");
  });

  it("interleaves up to two channels as 16-bit little-endian PCM", () => {
    const pcm = interleavePcm16([Float32Array.from([1, -1]), Float32Array.from([0, 2]), Float32Array.from([0.5, 0.5])]);
    const view = new DataView(pcm.buffer);
    expect(pcm.byteLength).toBe(8);
    expect([0, 2, 4, 6].map((offset) => view.getInt16(offset, true))).toEqual([32767, 0, -32768, 32767]);
  });

  it("keeps the WebM as recorded when WebM is chosen or outside the desktop app", async () => {
    const webm = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]);
    expect(await encodeRecording(webm, "webm")).toEqual({ bytes: webm, mime: "audio/webm", extension: "webm" });
    expect((await encodeRecording(webm, "mp3")).extension).toBe("webm");
  });
});
