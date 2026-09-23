import { describe, expect, it } from "vitest";
import type { Note } from "../src/model/note";
import {
  mergeLoadedNotes,
  parseProjectIndex,
  serializeProjectIndex,
} from "../src/project/index";

describe("project index", () => {
  it("round trips current board fields and preserves fields for later versions", () => {
    const note: Note = {
      id: "note-1",
      type: "note",
      name: "Research",
      text: "Hello",
      x: -12.5,
      y: 8,
      width: 30,
      height: null,
    };
    const template = parseProjectIndex(JSON.stringify({
      version: 1,
      futureIndexSetting: { enabled: true },
      notes: [{ id: note.id, name: note.name, file: "Research.md", x: 0, y: 0, width: 20, height: 40, futureNoteField: "kept" }],
    }));

    const parsed = parseProjectIndex(serializeProjectIndex([note], template));

    expect(parsed.version).toBe(1);
    expect(parsed.futureIndexSetting).toEqual({ enabled: true });
    expect(parsed.notes[0]).toMatchObject({
      id: "note-1",
      file: "Research.md",
      x: -12.5,
      y: 8,
      width: 30,
      height: null,
      futureNoteField: "kept",
    });
  });

  it("migrates unversioned indexes and derives missing file and height fields", () => {
    const migrated = parseProjectIndex(JSON.stringify({
      notes: [{ id: "legacy", name: "Old note", x: 4, y: 9, width: 24 }],
    }));

    expect(migrated.version).toBe(1);
    expect(migrated.notes[0]).toMatchObject({ file: "Old note.md", height: null });
  });

  it("merges Markdown bodies without taking geometry from the body response", () => {
    const index = parseProjectIndex(JSON.stringify({
      version: 1,
      notes: [{ id: "a", name: "A", file: "A.md", x: 1, y: 2, width: 3, height: 4 }],
    }));
    const notes = mergeLoadedNotes(index, [{
      id: "a", name: "A", file: "A.md", text: "Body", x: 1, y: 2, width: 3, height: 4,
    }]);

    expect(notes).toEqual([{
      id: "a", type: "note", name: "A", text: "Body", x: 1, y: 2, width: 3, height: 4,
    }]);
  });

  it.each([
    ["invalid JSON", "{"],
    ["non-object root", "[]"],
    ["unsupported version", JSON.stringify({ version: 2, notes: [] })],
    ["missing notes", JSON.stringify({ version: 1 })],
    ["non-finite geometry", JSON.stringify({ version: 1, notes: [{ id: "a", name: "A", x: 0, y: 0, width: Infinity }] })],
    ["path traversal", JSON.stringify({ version: 1, notes: [{ id: "a", name: "A", file: "../A.md", x: 0, y: 0, width: 10 }] })],
    ["duplicate ids", JSON.stringify({ version: 1, notes: [
      { id: "a", name: "A", x: 0, y: 0, width: 10 },
      { id: "a", name: "B", x: 1, y: 1, width: 10 },
    ] })],
    ["case-insensitive filenames", JSON.stringify({ version: 1, notes: [
      { id: "a", name: "A", file: "Note.md", x: 0, y: 0, width: 10 },
      { id: "b", name: "B", file: "note.md", x: 1, y: 1, width: 10 },
    ] })],
  ])("rejects %s", (_label, contents) => {
    expect(() => parseProjectIndex(contents)).toThrow();
  });

  it("does not silently accept a body response that disagrees with the index", () => {
    const index = parseProjectIndex(JSON.stringify({
      version: 1,
      notes: [{ id: "a", name: "A", file: "A.md", x: 1, y: 2, width: 3, height: null }],
    }));

    expect(() => mergeLoadedNotes(index, [{
      id: "a", name: "A", file: "A.md", text: "Body", x: 0, y: 2, width: 3, height: null,
    }])).toThrow("does not match board.json");
  });
});
