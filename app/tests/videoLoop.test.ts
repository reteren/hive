import { describe, expect, it } from "vitest";
import { parseMcpNote, serializeProjectNoteEntry } from "../src/project/index";
import type { Note } from "../src/model/note";

const media = { kind: "video" as const, file: "clip.mp4", mime: "video/mp4", name: "clip.mp4", size: 10, naturalWidth: 320, naturalHeight: 180, duration: 2 };

describe("video loop", () => {
  it("is saved for video nodes and read back", () => {
    const note = { id: "v", type: "video", name: "Clip", text: "", x: 0, y: 0, width: 32, height: 18, media, loop: true } as Note;
    const entry = serializeProjectNoteEntry(note, undefined, "Clip.md", new Set());
    expect(entry.loop).toBe(true);
    expect(parseMcpNote(JSON.parse(JSON.stringify(entry))).note.loop).toBe(true);
  });

  it("is dropped on other node kinds", () => {
    const note = { id: "n", type: "note", name: "Note", text: "", x: 0, y: 0, width: 20, height: null, loop: true } as unknown as Note;
    expect(serializeProjectNoteEntry(note, undefined, "Note.md", new Set()).loop).toBeUndefined();
    expect(parseMcpNote({ id: "n", type: "note", name: "Note", file: "Note.md", x: 0, y: 0, width: 20, loop: true }).note.loop).toBeUndefined();
  });
});
