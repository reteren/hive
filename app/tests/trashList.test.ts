import { afterEach, describe, expect, it } from "vitest";
import type { Note } from "../src/model/note";
import { replaceTrash, type TrashEntry } from "../src/model/retention.svelte";
import { listTrashEntries } from "../src/trash/trashActions.svelte";
import { summarizeTrashEntry } from "../src/trash/trashListModel";

function note(id: string, type: Note["type"] = "note"): Note {
  return { id, type, name: id, text: "", x: 0, y: 0, width: 30, height: null };
}

function entry(id: string, deletedAt: number, notes: Note[] = [], zones: TrashEntry["zones"] = [], links: TrashEntry["links"] = []): TrashEntry {
  return { id, deletedAt, notes, zones, links };
}

const workZone: TrashEntry["zones"][number] = {
  id: "work-zone",
  name: "Work",
  color: "#aabbcc",
  parts: [],
  holes: [],
};

afterEach(() => replaceTrash([]));

describe("trash list model", () => {
  it("formats a single note or zone by kind and name", () => {
    expect(summarizeTrashEntry(entry("note", 10, [note("3")]))).toEqual({
      kind: "note",
      label: "Note 3",
      objectCount: 1,
    });
    expect(summarizeTrashEntry(entry("beacon", 20, [note("North", "beacon")]))).toEqual({
      kind: "beacon",
      label: "Beacon North",
      objectCount: 1,
    });
    expect(summarizeTrashEntry(entry("zone", 30, [], [{ ...workZone }]))).toEqual({
      kind: "zone",
      label: "Zone Work",
      objectCount: 1,
    });
  });

  it("summarizes a multi-object delete and excludes associated links from the object count", () => {
    const multi = entry("multi", 40, [note("A"), note("B")], [{ ...workZone }], [
      { id: "ab", from: "A", to: "B", kind: "strong", shape: "base" },
    ]);

    expect(summarizeTrashEntry(multi)).toEqual({ kind: "objects", label: "3 objects", objectCount: 3 });
  });

  it("lists newest deletes first", () => {
    replaceTrash([
      entry("older", 10, [note("Old")]),
      entry("newer", 30, [note("New")]),
      entry("middle", 20, [note("Middle")]),
    ]);

    expect(listTrashEntries().map((item) => item.id)).toEqual(["newer", "middle", "older"]);
  });
});
