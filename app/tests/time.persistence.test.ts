import { describe, expect, it } from "vitest";
import type { Note } from "../src/model/note";
import { copyArchiveEntry, sanitizeArchiveEntries } from "../src/archive/serialization";
import { mergeLoadedNotes, parseProjectIndex, serializeProjectIndex } from "../src/project/index";
import { copyTrashEntry } from "../src/trash/trash";
import { sanitizeTrashEntries } from "../src/trash/serialization";
import type { TimeNodeData } from "../src/time/types";

const timeData: TimeNodeData = {
  schedule: { kind: "interval", minutes: 45, mode: "active", repeat: true },
  enabled: true,
  runtime: { countedMs: 123_000, lastCheckedAt: 456_000, lastFiredKey: "interval:active:0:1" },
  view: "stopwatch",
  stopwatch: {
    mode: "manual", running: true, elapsedMs: 80_000, startedAt: 500_000,
    nodeCreatedAppMs: 12_000, nodeCreatedActiveMs: 8_000,
  },
};

function timeNote(id: string): Note {
  return {
    id, type: "time", name: `Reminder ${id}`, text: "", x: 4, y: 8, width: 30, height: null,
    createdAt: 12, time: { ...timeData, schedule: { ...timeData.schedule }, runtime: { ...timeData.runtime } },
  };
}

describe("Time node retention", () => {
  it("round trips schedule and runtime through the project index", () => {
    const note = timeNote("time-project");
    const index = parseProjectIndex(serializeProjectIndex([note]));
    expect(index.notes[0]?.time).toEqual(timeData);
    const loaded = mergeLoadedNotes(index, [{
      id: note.id, name: note.name, file: index.notes[0]!.file, text: "",
      x: note.x, y: note.y, width: note.width, height: note.height,
    }]);
    expect(loaded[0]?.time).toEqual(timeData);
    expect(loaded[0]).toMatchObject({ type: "time", width: 30, height: null });
  });

  it("preserves Time data in archive entries and copies it independently", () => {
    const result = sanitizeArchiveEntries([{ id: "archive-time", archivedAt: 20, note: timeNote("time-archive"), links: [] }]);
    expect(result.warnings).toEqual([]);
    expect(result.entries[0]?.note.time).toEqual(timeData);
    const copied = copyArchiveEntry(result.entries[0]!);
    if (copied.note.time?.runtime) copied.note.time.runtime.countedMs = 0;
    if (copied.note.time?.stopwatch) copied.note.time.stopwatch.elapsedMs = 0;
    expect(result.entries[0]?.note.time?.runtime?.countedMs).toBe(123_000);
    expect(result.entries[0]?.note.time?.stopwatch?.elapsedMs).toBe(80_000);
  });

  it("preserves Time data in trash entries and deep-copies runtime state", () => {
    const result = sanitizeTrashEntries([{
      id: "trash-time", deletedAt: 30, notes: [timeNote("time-trash")], zones: [], links: [],
    }]);
    expect(result.warnings).toEqual([]);
    expect(result.entries[0]?.notes[0]?.time).toEqual(timeData);
    const copied = copyTrashEntry(result.entries[0]!);
    const nested = copied.notes[0]?.time?.runtime;
    if (nested) nested.countedMs = 0;
    if (copied.notes[0]?.time?.stopwatch) copied.notes[0].time.stopwatch.elapsedMs = 0;
    expect(result.entries[0]?.notes[0]?.time?.runtime?.countedMs).toBe(123_000);
    expect(result.entries[0]?.notes[0]?.time?.stopwatch?.elapsedMs).toBe(80_000);
  });
});
