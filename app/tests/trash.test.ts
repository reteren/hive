import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { calculators, replaceCalculators, setCalculatorData } from "../src/calculator/calculators.svelte";
import { clear, history, redo, undo } from "../src/history/history.svelte";
import { board, replaceBoard } from "../src/model/board.svelte";
import type { Link } from "../src/model/link";
import type { Note } from "../src/model/note";
import { replaceLinks, links } from "../src/model/links.svelte";
import { replaceTrash, trash, type TrashEntry } from "../src/model/retention.svelte";
import { addZone, replaceZones, zones } from "../src/model/zones.svelte";
import { selection } from "../src/selection/selection.svelte";
import { deletePermanently, emptyTrash, moveToTrash, previewRestore, restoreTrashEntry, resetTrashHistoryInvalidators } from "../src/trash/trashActions.svelte";
import { parseProjectIndex, serializeProjectIndex } from "../src/project/index";
import { sanitizeTrashEntries } from "../src/trash/serialization";

function note(id: string, name = id, type: Note["type"] = "note"): Note {
  return { id, type, name, text: `Text of ${id}`, x: 10, y: 20, width: 30, height: null };
}

function link(id: string, from: string, to: string): Link {
  return { id, from, to, kind: "strong", shape: "base" };
}

function entry(id: string, notes: Note[], edges: Link[] = [], zonesValue: TrashEntry["zones"] = []): TrashEntry {
  return { id, deletedAt: 42, notes, links: edges, zones: zonesValue };
}

beforeEach(() => {
  clear();
  resetTrashHistoryInvalidators();
  replaceBoard([]);
  replaceLinks([]);
  replaceZones([]);
  replaceTrash([]);
  replaceCalculators({});
  selection.ids = [];
  selection.zoneIds = [];
  selection.primaryId = null;
});

afterEach(() => {
  clear();
  resetTrashHistoryInvalidators();
  replaceBoard([]);
  replaceLinks([]);
  replaceZones([]);
  replaceTrash([]);
  replaceCalculators({});
});

describe("trash actions", () => {
  it("creates one entry per selected object while keeping the batch in one Undo step", () => {
    const first = note("A", "Research");
    first.task = { done: true, doneAt: 100 };
    first.purposes = ["concept"];
    replaceBoard([first, note("B"), note("C")]);
    replaceLinks([link("ab", "A", "B"), link("bc", "B", "C")]);
    const zone = {
      id: "zone-a", name: "Work", color: "#608ac1",
      parts: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]], holes: [],
    };
    addZone(zone);
    selection.ids = ["A"];
    selection.zoneIds = ["zone-a"];
    selection.primaryId = "A";

    const created = moveToTrash(["A"], ["zone-a"]);
    expect(created).toHaveLength(2);
    expect(created?.find((item) => item.notes.length > 0)?.notes[0]).toMatchObject({ text: "Text of A", task: { done: true }, purposes: ["concept"] });
    expect(board.order).toEqual(["B", "C"]);
    expect(zones.order).toEqual([]);
    expect(Object.keys(links.byId)).toEqual(["bc"]);
    expect(trash.entries).toHaveLength(2);
    expect(trash.entries.find((item) => item.notes.length > 0)?.links.map((edge) => edge.id)).toEqual(["ab"]);
    expect(trash.entries.find((item) => item.zones.length > 0)?.zones[0]?.id).toBe("zone-a");
    expect(history.entries).toHaveLength(1);

    undo();
    expect(board.order).toEqual(["A", "B", "C"]);
    expect(zones.order).toEqual(["zone-a"]);
    expect(links.byId.ab).toBeDefined();
    expect(trash.entries).toEqual([]);
    redo();
    expect(trash.entries).toHaveLength(2);
  });

  it("splits shared links across per-object entries and restores each link when its other end returns", () => {
    replaceBoard([note("A"), note("B"), note("C")]);
    replaceLinks([link("ab", "A", "B"), link("bc", "B", "C")]);

    const created = moveToTrash(["A", "B", "C"]);
    expect(created).toHaveLength(3);
    expect(trash.entries.map((item) => item.notes[0]?.id)).toEqual(["A", "B", "C"]);
    expect(trash.entries.map((item) => item.links.map((edge) => edge.id))).toEqual([[
      "ab",
    ], ["ab", "bc"], ["bc"]]);

    const firstId = trash.entries.find((item) => item.notes[0]?.id === "A")!.id;
    const secondId = trash.entries.find((item) => item.notes[0]?.id === "B")!.id;
    expect(previewRestore(firstId)?.linksBroken.map(({ link: edge }) => edge.id)).toEqual(["ab"]);
    restoreTrashEntry(firstId);
    expect(board.notes.A).toBeDefined();
    expect(links.byId.ab).toBeUndefined();

    expect(previewRestore(secondId)?.linksRestored.map((edge) => edge.id)).toEqual(["ab"]);
    restoreTrashEntry(secondId);
    expect(links.byId.ab).toBeDefined();
    expect(links.byId.bc).toBeUndefined();
    const thirdId = trash.entries[0]!.id;
    restoreTrashEntry(thirdId);
    expect(links.byId.bc).toBeDefined();
  });

  it("restores legacy multi-object entries as a group", () => {
    const legacy = entry("old-group", [note("A"), note("B")], [link("ab", "A", "B")]);
    const loaded = parseProjectIndex(serializeProjectIndex([], undefined, [], [], [], [], {}, [], [legacy]));
    replaceTrash(loaded.trash);

    const restored = restoreTrashEntry(legacy.id);
    expect(restored?.linksRestored.map((edge) => edge.id)).toEqual(["ab"]);
    expect(board.order).toEqual(["A", "B"]);
    expect(links.byId.ab).toBeDefined();
    expect(trash.entries).toEqual([]);
    undo();
    expect(board.order).toEqual([]);
    expect(trash.entries).toEqual([legacy]);
  });

  it("previews missing links and renames a collision before restoring", () => {
    const saved = entry("delete-A", [note("A", "Report")], [link("ab", "A", "B"), link("ac", "A", "C")]);
    replaceTrash([saved]);
    replaceBoard([note("B"), note("same-name", "Report")]);
    const preview = previewRestore(saved.id);
    expect(preview?.linksRestored.map((edge) => edge.id)).toEqual(["ab"]);
    expect(preview?.linksBroken).toMatchObject([{ link: { id: "ac" }, missingEndpoints: ["C"] }]);
    expect(preview?.renamed).toEqual([{ noteId: "A", from: "Report", to: "Report 2" }]);

    const result = restoreTrashEntry(saved.id);
    expect(result?.renamed[0]?.to).toBe("Report 2");
    expect(board.notes.A).toMatchObject({ name: "Report 2", text: "Text of A" });
    expect(Object.keys(links.byId)).toEqual(["ab"]);
    expect(trash.entries).toEqual([]);
    expect(history.entries).toHaveLength(1);
    undo();
    expect(board.notes.A).toBeUndefined();
    expect(links.byId.ab).toBeUndefined();
    expect(trash.entries).toEqual([saved]);
  });

  it("keeps mirrored calculator data in trash and prunes it after permanent deletion", () => {
    const calculator = note("calc", "Budget", "calculator");
    replaceBoard([calculator]);
    const data = { entries: [{ id: "e", expression: "2 + 3" }], bank: null, rows: [] };
    setCalculatorData("Budget", data);
    moveToTrash([calculator.id]);
    expect(calculators.byKey.budget).toEqual(data);
    const trashed = trash.entries[0];
    expect(trashed.calculators?.budget).toEqual(data);
    deletePermanently(trashed.id);
    expect(calculators.byKey.budget).toBeUndefined();
    undo();
    expect(board.notes.calc).toBeUndefined();
    expect(trash.entries).toEqual([]);
  });

  it("restores calculator data carried by its trash entry when the live cache is absent", () => {
    const calculator = note("calc", "Budget", "calculator");
    replaceBoard([calculator]);
    const data = { entries: [{ id: "e", expression: "9 * 8" }], bank: null, rows: [] };
    setCalculatorData("Budget", data);
    moveToTrash([calculator.id]);
    replaceCalculators({});

    restoreTrashEntry(trash.entries[0].id);
    expect(calculators.byKey.budget).toEqual(data);
  });

  it("keeps calculator contents with the restored node when its name must change", () => {
    const calculator = note("calc", "Budget", "calculator");
    const data = { entries: [{ id: "e", expression: "9 * 8" }], bank: null, rows: [] };
    const saved = entry("deleted", [calculator]);
    saved.calculators = { budget: data };
    replaceTrash([saved]);
    replaceBoard([note("ordinary", "Budget")]);

    restoreTrashEntry(saved.id);
    expect(board.notes.calc?.name).toBe("Budget 2");
    expect(calculators.byKey["budget 2"]).toEqual(data);
  });

  it("purges one entry or all entries without creating history steps", () => {
    replaceTrash([entry("first", [note("A")]), entry("second", [note("B")])]);
    deletePermanently("first");
    expect(trash.entries.map((item) => item.id)).toEqual(["second"]);
    expect(emptyTrash().map((item) => item.id)).toEqual(["second"]);
    expect(history.entries).toHaveLength(0);
  });

  it("does not resurrect a permanently purged entry through an older Undo or Redo", () => {
    replaceBoard([note("A")]);
    moveToTrash(["A"]);
    const id = trash.entries[0].id;
    deletePermanently(id);
    undo();
    redo();
    expect(board.notes.A).toBeUndefined();
    expect(trash.entries).toEqual([]);
  });

  it("keeps a purged object absent while Undo restores the other objects from the batch", () => {
    replaceBoard([note("A"), note("B")]);
    const created = moveToTrash(["A", "B"]);
    const firstEntry = created![0]!;
    deletePermanently(firstEntry.id);

    undo();
    expect(board.notes.A).toBeUndefined();
    expect(board.notes.B).toBeDefined();
    expect(trash.entries).toEqual([]);
  });
});

describe("trash persistence", () => {
  it("round trips trashed note text, formatting, zones and dangling links", () => {
    const savedNote = note("A", "Resurfaced");
    savedNote.task = { done: true, doneAt: 100 };
    savedNote.moods = ["curiosity"];
    const saved = entry("deleted", [savedNote], [link("missing", "A", "removed")], [{
      id: "z", name: "Area", color: "#608ac1",
      parts: [[{ x: 1, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 4 }]], holes: [],
    }]);
    const parsed = parseProjectIndex(serializeProjectIndex([], undefined, [], [], [], [], {}, [], [saved]));
    expect(parsed.trash).toEqual([saved]);
    expect(parsed.notes).toEqual([]);
  });

  it("round trips calculator data held by a trash entry", () => {
    const calculator = note("calc", "Budget", "calculator");
    const data = { entries: [{ id: "e", expression: "5+5" }], bank: null, rows: [] };
    const saved = entry("deleted", [calculator]);
    saved.calculators = { budget: data };
    const parsed = parseProjectIndex(serializeProjectIndex([], undefined, [], [], [], [], {}, [], [saved]));
    expect(parsed.trash).toEqual([saved]);
    expect(parsed.calculators).toEqual({ budget: data });
  });

  it("drops invalid trash records and reports a warning", () => {
    const valid = entry("good", [note("A")]);
    const invalid = { ...valid, id: "bad", notes: [{ ...note("broken"), x: Number.NaN }] };
    const result = sanitizeTrashEntries([valid, invalid]);
    expect(result.entries).toEqual([valid]);
    expect(result.warnings).toHaveLength(1);
  });

  it("keeps calculator history available while its node is in trash", () => {
    const calculator = note("calc", "Budget", "calculator");
    const saved = entry("deleted", [calculator]);
    const data = { entries: [{ id: "e", expression: "2 + 3" }], bank: null, rows: [] };
    const contents = serializeProjectIndex([], undefined, [], [], [], [], { budget: data }, [], [saved]);
    expect(parseProjectIndex(contents).calculators).toEqual({ budget: data });
  });
});
