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

    expect(parsed.version).toBe(3);
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

  it("round trips mirrored calculator data, prunes orphan keys, and assigns per-node Markdown files", () => {
    const notes: Note[] = [
      { id: "calc-a", type: "calculator", name: "Trip", text: "", x: 0, y: 0, width: 40, height: null },
      { id: "calc-b", type: "calculator", name: "trip", text: "", x: 50, y: 0, width: 40, height: null },
    ];
    const data = {
      entries: [{ id: "entry-1", expression: "2 + 3" }],
      bank: { name: "Travel", initial: 100 },
      rows: [{ id: "row-1", label: "Book", amount: 20, sourceNoteId: "source" }],
    };
    const contents = serializeProjectIndex(notes, undefined, [], [], [], [], {
      TRIP: data,
      orphan: { entries: [], bank: null, rows: [] },
    });
    const raw = JSON.parse(contents) as { version: number; notes: Array<{ id: string; file: string }>; calculators: Record<string, unknown> };
    const parsed = parseProjectIndex(contents);

    expect(raw.version).toBe(3);
    expect(raw.calculators).toEqual({ trip: data });
    expect(raw.notes[0]?.file).not.toBe(raw.notes[1]?.file);
    expect(parsed.calculators).toEqual({ trip: data });
    expect(mergeLoadedNotes(parsed, parsed.notes.map((note) => ({
      id: note.id, name: note.name, file: note.file, text: "unused Markdown", x: note.x, y: note.y,
      width: note.width, height: note.height,
    }))).map((note) => note.text)).toEqual(["", ""]);
  });

  it("keeps calculator Markdown paths unique even when a note uses the generated calculator name", () => {
    const notes: Note[] = [
      { id: "calc-id", type: "calculator", name: "Ledger", text: "", x: 0, y: 0, width: 40, height: null },
      { id: "note-id", type: "note", name: "Calculator-calc-id", text: "Body", x: 50, y: 0, width: 30, height: null },
    ];

    const index = parseProjectIndex(serializeProjectIndex(notes));
    expect(index.notes.map((note) => note.file)).toEqual(["Calculator-calc-id 2.md", "Calculator-calc-id.md"]);
    expect(new Set(index.notes.map((note) => note.file.toLowerCase())).size).toBe(2);
  });

  it("defaults calculator state for older boards and canonicalizes case-insensitive persisted keys", () => {
    const missing = parseProjectIndex(JSON.stringify({ version: 2, notes: [] }));
    expect(missing.calculators).toEqual({});

    const data = { entries: [{ id: "e", expression: "1+1" }], bank: null, rows: [] };
    const parsed = parseProjectIndex(JSON.stringify({
      version: 3,
      notes: [{ id: "calc", name: "Trip", type: "calculator", x: 0, y: 0, width: 40 }],
      calculators: { TRIP: data },
    }));
    expect(parsed.calculators).toEqual({ trip: data });
  });

  it("migrates unversioned indexes and derives missing file and height fields", () => {
    const migrated = parseProjectIndex(JSON.stringify({
      notes: [{ id: "legacy", name: "Old note", x: 4, y: 9, width: 24 }],
    }));

    expect(migrated.version).toBe(3);
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

    expect(migrated.index.version).toBe(3);
    expect(migrated.index.links).toEqual([{ ...link, shape: "base" }]);
    expect(migrated.index.taskLog).toEqual([]);
    expect(migrated.warnings).toEqual([]);
  });

  it("migrates a v2 board with links and task history to v3 project state", () => {
    const migrated = parseProjectIndexWithWarnings(JSON.stringify({
      version: 2,
      notes: [{
        id: "legacy", name: "Legacy", x: 0, y: 0, width: 10, height: null,
        type: "note", task: null, taskMemory: null, importance: null, purposes: [], moods: [],
      }],
      taskLog: [],
      links: [],
      futureIndexField: { kept: true },
    }));

    expect(migrated.index.version).toBe(3);
    expect(migrated.index.zones).toEqual([]);
    expect(migrated.index.beaconMarks).toEqual([]);
    expect(migrated.index.futureIndexField).toEqual({ kept: true });
    expect(migrated.warnings).toEqual([]);
  });

  it("normalizes fixed-size R5 and R6 node dimensions when loading notes", () => {
    const notes: Note[] = [
      { id: "goal", type: "goal", name: "Goal", text: "", x: 0, y: 0, width: 88, height: 62 },
      { id: "progress", type: "progress", name: "Progress", text: "", x: 50, y: 0, width: 88, height: 62 },
      { id: "stats", type: "stats", name: "Statistics", text: "", x: 100, y: 0, width: 88, height: 62 },
      { id: "trash", type: "trash", name: "Trash", text: "", x: 150, y: 0, width: 88, height: 62 },
      { id: "archive", type: "archive", name: "Archive", text: "", x: 200, y: 0, width: 88, height: 62 },
    ];
    const index = parseProjectIndex(serializeProjectIndex(notes));
    const loaded = mergeLoadedNotes(index, index.notes.map((note) => ({
      id: note.id,
      name: note.name,
      file: note.file,
      text: "",
      x: note.x,
      y: note.y,
      width: note.width,
      height: note.height,
    })));

    expect(loaded.map(({ width, height }) => [width, height])).toEqual([
      [30, null],
      [30, null],
      [30, null],
      [40, 40],
      [40, 40],
    ]);
  });

  it("round trips beacon colour, zone membership, undersized legacy zones and ordered marks", () => {
    const zone = {
      id: "zone-a",
      name: "Research",
      color: "#608ac1",
      parts: [[{ x: -10, y: -8 }, { x: 2, y: -8 }, { x: 2, y: 10 }, { x: -10, y: 10 }]],
      holes: [[{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 8 }, { x: 2, y: 8 }]],
      createdAt: 1_700_000_000_000,
    };
    const beacon: Note = {
      id: "beacon-a", type: "beacon", name: "North", text: "", x: 0, y: 0, width: 7.2, height: 7.2,
      color: "#69b7a5", zoneId: "zone-a",
    };
    const parsed = parseProjectIndex(serializeProjectIndex([beacon], undefined, [], [], [zone], ["beacon-a", "me"]));
    const loaded = mergeLoadedNotes(parsed, [{
      id: beacon.id, name: beacon.name, file: "North.md", text: "", x: beacon.x, y: beacon.y,
      width: beacon.width, height: beacon.height,
    }]);

    expect(loaded).toEqual([{ ...beacon, task: null, taskMemory: null, importance: null, purposes: [] }]);
    expect(parsed.zones).toEqual([zone]);
    expect(parsed.beaconMarks).toEqual(["beacon-a", "me"]);
  });

  it("defaults invalid colours and removes invalid polygons with warnings", () => {
    const parsed = parseProjectIndexWithWarnings(JSON.stringify({
      version: 3,
      notes: [{
        id: "beacon", name: "Beacon", x: 0, y: 0, width: 7.2, height: 7.2, type: "beacon",
        task: null, taskMemory: null, importance: null, purposes: [], moods: [], color: "ultraviolet", zoneId: "good",
      }],
      taskLog: [],
      beaconMarks: ["beacon", "missing", "beacon", "me"],
      zones: [
        { id: "good", name: "Good", color: "bad", parts: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]], holes: [], createdAt: -1 },
        { id: "bad", name: "Bad", color: "#608ac1", parts: [[{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }]], holes: [] },
      ],
    }));

    expect(parsed.index.notes[0]).toMatchObject({ color: "#e8b030", zoneId: "good" });
    expect(parsed.index.zones[0]).toMatchObject({ id: "good", color: "#608ac1" });
    expect(parsed.index.zones[0]?.createdAt).toBeUndefined();
    expect(parsed.index.beaconMarks).toEqual(["beacon", "me"]);
    expect(parsed.warnings).toEqual(expect.arrayContaining([
      "Invalid beacon colour for note beacon; default colour was used.",
      "Invalid zones or polygons in board.json were discarded.",
      "Invalid zone colours were replaced with the default colour.",
      "Invalid zone creation times were cleared.",
      "Invalid beacon marks were discarded.",
    ]));
  });

  it("migrates removed straight and renamed curved line shapes to base", () => {
    const migrated = parseProjectIndexWithWarnings(JSON.stringify({
      version: 1,
      notes: [
        { id: "a", name: "A", x: 0, y: 0, width: 10 },
        { id: "b", name: "B", x: 20, y: 0, width: 10 },
        { id: "c", name: "C", x: 40, y: 0, width: 10 },
        { id: "d", name: "D", x: 60, y: 0, width: 10 },
      ],
      links: [
        { id: "ab", from: "a", to: "b", kind: "strong", shape: "straight" },
        { id: "cd", from: "c", to: "d", kind: "weak", shape: "curved" },
      ],
    }));

    expect(migrated.index.links?.map(({ id, shape }) => ({ id, shape }))).toEqual([
      { id: "ab", shape: "base" },
      { id: "cd", shape: "base" },
    ]);
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
        id: "purpose-1", type: "purpose", name: "Decision", text: "", x: 20, y: 12, width: 8, height: null,
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
    const link = { id: "ab", from: "a", to: "b", kind: "strong" as const, shape: "base" as const };
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
    ["unsupported version", JSON.stringify({ version: 4, notes: [] })],
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
