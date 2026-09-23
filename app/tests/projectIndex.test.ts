import { describe, expect, it } from "vitest";
import type { Note } from "../src/model/note";
import {
  mergeLoadedNotes,
  parseProjectIndex,
  parseProjectIndexWithWarnings,
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

    expect(parsed.version).toBe(2);
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

    expect(migrated.version).toBe(2);
    expect(migrated.notes[0]).toMatchObject({
      file: "Old note.md", height: null, type: "note", task: null, taskMemory: null,
      importance: null, purposes: [],
    });
  });

  it("migrates v1 indexes with links and supplies an empty task log", () => {
    const link = { id: "ab", from: "a", to: "b", kind: "weak" as const, shape: "straight" as const };
    const migrated = parseProjectIndexWithWarnings(JSON.stringify({
      version: 1,
      notes: [
        { id: "a", name: "A", x: 0, y: 0, width: 10 },
        { id: "b", name: "B", x: 20, y: 0, width: 10 },
      ],
      links: [link],
    }));

    expect(migrated.index.version).toBe(2);
    expect(migrated.index.links).toEqual([link]);
    expect(migrated.index.taskLog).toEqual([]);
    expect(migrated.warnings).toEqual([]);
  });

  it("round trips all R3 fields and the task completion log", () => {
    const notes: Note[] = [
      {
        id: "pro-1", type: "pro", name: "Benefit", text: "Positive", x: -3, y: 8, width: 14, height: 9,
        task: { done: true, doneAt: 1_700_000_000_000 },
        taskMemory: { done: false, doneAt: null }, importance: "absolute", purposes: ["concept", "decision"],
      },
      {
        id: "con-1", type: "con", name: "Risk", text: "Negative", x: 4, y: 12, width: 11, height: null,
        task: { done: false, doneAt: null }, taskMemory: null,
        importance: "medium", purposes: ["openQuestion", "experiment"],
      },
      {
        id: "purpose-1", type: "purpose", name: "Decision", text: "", x: 20, y: 12, width: 8, height: 6,
        task: null, taskMemory: null, importance: null, purposes: ["decision"],
      },
      {
        id: "importance-1", type: "importance", name: "Urgent", text: "", x: 35, y: 12, width: 8, height: 6,
        task: null, taskMemory: null, importance: "immediately", purposes: [],
      },
    ];
    const taskLog = [{ noteId: "pro-1", name: "Benefit", doneAt: 1_700_000_000_000 }];
    const parsed = parseProjectIndex(serializeProjectIndex(notes, undefined, [], taskLog));
    const loadedNotes = mergeLoadedNotes(parsed, notes.map(({ id, name, text, x, y, width, height }) => ({
      id, name, file: `${name}.md`, text, x, y, width, height,
    })));

    expect(loadedNotes).toEqual(notes);
    expect(parsed.taskLog).toEqual(taskLog);
  });

  it("defaults invalid R3 fields and warns while retaining valid purposes", () => {
    const parsed = parseProjectIndexWithWarnings(JSON.stringify({
      version: 2,
      notes: [{
        id: "bad-r3", name: "Fallback", x: 0, y: 0, width: 10,
        type: "zone", task: { done: true, doneAt: null }, taskMemory: { done: false, doneAt: 10 },
        importance: "urgent",
        purposes: ["concept", "unknown", "concept"],
      }],
      taskLog: [{ noteId: "bad-r3", name: "Fallback", doneAt: -1 }],
    }));

    expect(parsed.index.notes[0]).toMatchObject({
      type: "note", task: null, taskMemory: null, importance: null, purposes: ["concept"],
    });
    expect(parsed.index.taskLog).toEqual([]);
    expect(parsed.warnings).toEqual([
      "Invalid type for note bad-r3; defaulted to note.",
      "Invalid task state for note bad-r3; task flag was cleared.",
      "Invalid remembered task state for note bad-r3; remembered state was cleared.",
      "Invalid importance for note bad-r3; importance was cleared.",
      "Invalid purpose values for note bad-r3; unknown values were discarded.",
      "Invalid task log entries in board.json were discarded.",
    ]);
  });

  it("round trips links and drops dangling links with a warning", () => {
    const notes: Note[] = [
      { id: "a", type: "note", name: "A", text: "", x: 0, y: 0, width: 10, height: null },
      { id: "b", type: "note", name: "B", text: "", x: 20, y: 0, width: 10, height: null },
    ];
    const link = { id: "ab", from: "a", to: "b", kind: "strong" as const, shape: "straight" as const };
    const roundTrip = parseProjectIndex(serializeProjectIndex(notes, undefined, [link]));
    expect(roundTrip.links).toEqual([link]);

    const loaded = parseProjectIndexWithWarnings(JSON.stringify({
      version: 1,
      notes: notes.map(({ id, name, x, y, width, height }) => ({ id, name, x, y, width, height })),
      links: [link, { ...link, id: "dangling", to: "missing" }],
    }));
    expect(loaded.index.links).toEqual([link]);
    expect(loaded.warnings).toEqual(["Invalid or dangling links in board.json were discarded."]);
  });

  it("round trips anchored links from ME and ignores links that point into ME", () => {
    const notes: Note[] = [
      { id: "a", type: "note", name: "A", text: "", x: 0, y: 0, width: 10, height: null },
    ];
    const outgoing = {
      id: "me-a",
      from: "me",
      to: "a",
      kind: "strong" as const,
      shape: "zigzag" as const,
      toAnchor: { x: 0.25, y: 1 },
    };
    const roundTrip = parseProjectIndex(serializeProjectIndex(notes, undefined, [outgoing]));
    expect(roundTrip.links).toEqual([outgoing]);

    const parsed = parseProjectIndexWithWarnings(JSON.stringify({
      version: 1,
      notes: [{ id: "a", name: "A", x: 0, y: 0, width: 10 }],
      links: [outgoing, { ...outgoing, id: "incoming", from: "a", to: "me" }],
    }));
    expect(parsed.index.links).toEqual([outgoing]);
    expect(parsed.warnings).toEqual(["Invalid or dangling links in board.json were discarded."]);
  });

  it("discards links with invalid persisted anchors", () => {
    const parsed = parseProjectIndexWithWarnings(JSON.stringify({
      version: 1,
      notes: [
        { id: "a", name: "A", x: 0, y: 0, width: 10 },
        { id: "b", name: "B", x: 20, y: 0, width: 10 },
      ],
      links: [{
        id: "ab", from: "a", to: "b", kind: "strong", shape: "straight", fromAnchor: { x: 2, y: 0.5 },
      }],
    }));
    expect(parsed.index.links).toEqual([]);
    expect(parsed.warnings).toEqual(["Invalid or dangling links in board.json were discarded."]);
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
      task: null, taskMemory: null, importance: null, purposes: [],
    }]);
  });

  it.each([
    ["invalid JSON", "{"],
    ["non-object root", "[]"],
    ["unsupported version", JSON.stringify({ version: 3, notes: [] })],
    ["missing notes", JSON.stringify({ version: 1 })],
    ["non-finite geometry", JSON.stringify({ version: 1, notes: [{ id: "a", name: "A", x: 0, y: 0, width: Infinity }] })],
    ["path traversal", JSON.stringify({ version: 1, notes: [{ id: "a", name: "A", file: "../A.md", x: 0, y: 0, width: 10 }] })],
    ["reserved ME id", JSON.stringify({ version: 1, notes: [{ id: "me", name: "A", x: 0, y: 0, width: 10 }] })],
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
