import { describe, expect, it } from "vitest";
import { recordingExports, recordingFileName } from "../src/audio/exportRecordings";
import type { MediaRef } from "../src/attachments/types";
import type { Note } from "../src/model/note";

const media = (file: string): MediaRef => ({ file, mime: "audio/mpeg", size: 1, kind: "audio" });
const note = (patch: Partial<Note>): Note => ({ id: "n", type: "audio", name: "Clip", text: "", x: 0, y: 0, width: 34, height: null, createdAt: 0, ...patch }) as Note;

describe("recording export", () => {
  it("adds the attachment extension unless the name has one", () => {
    expect(recordingFileName("Recording 1", media("abc.mp3"))).toBe("Recording 1.mp3");
    expect(recordingFileName("song.flac", media("abc.mp3"))).toBe("song.flac");
  });

  it("collects plain audio nodes and every dictaphone take, skipping other nodes", () => {
    const exports = recordingExports([
      note({ media: media("a.mp3") }),
      note({ name: "Recorder", recordings: [
        { id: "1", name: "Recording 1", media: media("b.ogg") },
        { id: "2", name: "Recording 1", media: media("c.wav") },
      ] }),
      note({ type: "text" as Note["type"] }),
      undefined,
    ]);
    expect(exports.map((item) => item.name)).toEqual(["Clip.mp3", "Recording 1.ogg", "Recording 1.wav"]);
  });
});
