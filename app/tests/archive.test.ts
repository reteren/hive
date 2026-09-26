import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { camera } from "../src/board/camera.svelte";
import { calculators, replaceCalculators, setCalculatorData } from "../src/calculator/calculators.svelte";
import { clear, history, redo, undo } from "../src/history/history.svelte";
import { board, replaceBoard } from "../src/model/board.svelte";
import type { Link } from "../src/model/link";
import { links, replaceLinks } from "../src/model/links.svelte";
import type { Note } from "../src/model/note";
import { archive, replaceArchive, type ArchiveEntry } from "../src/model/retention.svelte";
import { selection } from "../src/selection/selection.svelte";
import { archiveNotes, deleteArchivedPermanently, duplicateArchivedNear, restoreArchived } from "../src/archive/actions.svelte";
import { planArchiveRestore } from "../src/archive/logic";
import { sanitizeArchiveEntries } from "../src/archive/serialization";
import { parseProjectIndex, serializeProjectIndex } from "../src/project/index";

function note(id: string, x = 0, type: Note["type"] = "note"): Note {
  return { id, type, name: id, text: `Text of ${id}`, x, y: 4, width: 30, height: 20 };
}

function link(id: string, from: string, to: string): Link {
  return { id, from, to, kind: "weak", shape: "base" };
}

function entry(item: Note, edges: Link[] = []): ArchiveEntry {
  return { id: `entry-${item.id}`, archivedAt: 42, note: item, links: edges };
}

beforeEach(() => {
  clear();
  replaceBoard([]);
  replaceLinks([]);
  replaceArchive([]);
  replaceCalculators({});
  selection.ids = [];
  selection.zoneIds = [];
  selection.primaryId = null;
  camera.x = 0;
  camera.y = 0;
});

afterEach(() => {
  clear();
  replaceBoard([]);
  replaceLinks([]);
  replaceArchive([]);
  replaceCalculators({});
});

describe("archive actions", () => {
  it("archives a mixed selection and its links in one Undo step", () => {
    replaceBoard([note("A"), note("B", 40, "pro"), note("C", 80), note("beacon", 120, "beacon")]);
    replaceLinks([link("ab", "A", "B"), link("bc", "B", "C")]);
    selection.ids = ["A", "B", "beacon"];
    selection.primaryId = "B";

    expect(archiveNotes(selection.ids)).toBe(2);
    expect(board.order).toEqual(["C", "beacon"]);
    expect(Object.keys(links.byId)).toEqual([]);
    expect(archive.entries.map((item) => item.note.id)).toEqual(["A", "B"]);
    expect(history.entries).toHaveLength(1);
    expect(selection.ids).toEqual(["beacon"]);

    undo();
    expect(board.order).toEqual(["A", "B", "C", "beacon"]);
    expect(Object.keys(links.byId).sort()).toEqual(["ab", "bc"]);
    expect(archive.entries).toEqual([]);
    expect(selection.ids).toEqual(["A", "B", "beacon"]);
    redo();
    expect(archive.entries).toHaveLength(2);
  });

  it("restores at the old position, renames on collision, and keeps only surviving links", () => {
    const item = note("A", 12);
    item.name = "Original";
    replaceArchive([entry(item, [link("ab", "A", "B"), link("ac", "A", "C")])]);
    const colliding = note("X", 12);
    colliding.name = "Original";
    replaceBoard([colliding, note("B", 70)]);

    const plan = planArchiveRestore(archive.entries[0], "old", camera, Object.values(board.notes), []);
    expect(plan).toMatchObject({ nameChanged: true, placeOccupied: true });
    expect(plan.links.map((edge) => edge.id)).toEqual(["ab"]);
    expect(plan.missingLinks.map((edge) => edge.id)).toEqual(["ac"]);

    const restored = restoreArchived("entry-A", "old");
    expect(restored?.note).toMatchObject({ x: 12, y: 4, name: "Original 2", text: "Text of A" });
    expect(Object.keys(links.byId)).toEqual(["ab"]);
    expect(archive.entries).toEqual([]);
    expect(history.entries).toHaveLength(1);
    undo();
    expect(board.notes.A).toBeUndefined();
    expect(links.byId.ab).toBeUndefined();
    expect(archive.entries).toHaveLength(1);
  });

  it("restores to the current screen centre in one step", () => {
    replaceArchive([entry(note("A", 400))]);
    camera.x = 100;
    camera.y = 50;
    const result = restoreArchived("entry-A", "centre");
    expect(result?.note.x).toBe(85);
    expect(result?.note.y).toBe(40);
    expect(history.entries).toHaveLength(1);
    undo();
    expect(archive.entries).toHaveLength(1);
  });

  it("duplicates with a new id, independent content, no links, and retains the archived source", () => {
    replaceBoard([note("archive-node", 0, "archive")]);
    replaceArchive([entry(note("A", 200), [link("ab", "A", "B")])]);
    const duplicate = duplicateArchivedNear("entry-A", "archive-node");
    expect(duplicate).not.toBeNull();
    expect(duplicate?.id).not.toBe("A");
    expect(duplicate?.name).toBe("A copy");
    expect(duplicate?.x).toBeGreaterThan(board.notes["archive-node"].x);
    expect(Object.keys(links.byId)).toEqual([]);
    expect(archive.entries).toHaveLength(1);
    board.notes[duplicate!.id].text = "Changed copy";
    expect(archive.entries[0].note.text).toBe("Text of A");
    expect(history.entries).toHaveLength(1);
    undo();
    expect(board.notes[duplicate!.id]).toBeUndefined();
  });

  it("preserves calculator data when archiving the last mirror, and uses live data for a surviving mirror", () => {
    const first = note("calc-a", 0, "calculator");
    first.name = "Budget";
    const second = note("calc-b", 40, "calculator");
    second.name = "Budget";
    replaceBoard([first, second]);
    const original = { entries: [{ id: "e", expression: "1 + 2" }], bank: null, rows: [] };
    setCalculatorData("Budget", original);
    archiveNotes([first.id]);
    expect(calculators.byKey.budget).toEqual(original);
    const updated = { entries: [{ id: "new", expression: "4 + 5" }], bank: null, rows: [] };
    setCalculatorData("Budget", updated);
    const preview = planArchiveRestore(archive.entries[0], "old", camera, Object.values(board.notes), [],
      Object.keys(calculators.byKey));
    expect(preview.calculatorUsesLiveData).toBe(true);
    expect(preview.note.name).toBe("Budget");
    restoreArchived(archive.entries[0].id, "old");
    expect(calculators.byKey.budget).toEqual(updated);
    archiveNotes([first.id, second.id]);
    expect(calculators.byKey.budget).toBeUndefined();
  });

  it("permanently removes only the chosen archive entry", () => {
    replaceArchive([entry(note("A")), entry(note("B"))]);
    deleteArchivedPermanently("entry-A");
    expect(archive.entries.map((item) => item.note.id)).toEqual(["B"]);
    expect(history.entries).toHaveLength(0);
  });

  it("does not resurrect a permanently deleted archive entry through an older Undo step", () => {
    replaceBoard([note("A"), note("B", 40)]);
    replaceLinks([link("me-a", "me", "A"), link("ab", "A", "B")]);
    archiveNotes(["A"]);
    const archivedId = archive.entries[0].id;
    deleteArchivedPermanently(archivedId);
    undo();
    expect(board.notes.A).toBeUndefined();
    expect(links.byId["me-a"]).toBeUndefined();
    expect(archive.entries).toEqual([]);
    redo();
    expect(board.notes.A).toBeUndefined();
  });

  it("restores a link to ME on Undo of archive", () => {
    replaceBoard([note("A")]);
    replaceLinks([link("me-a", "me", "A")]);
    archiveNotes(["A"]);
    undo();
    expect(links.byId["me-a"]).toBeDefined();
  });
});

describe("archive persistence", () => {
  it("round trips archived text, formatting and dangling links in board.json", () => {
    const item = note("A");
    item.task = { done: true, doneAt: 100 };
    item.purposes = ["concept"];
    const archived = entry(item, [link("missing", "A", "removed")]);
    const parsed = parseProjectIndex(serializeProjectIndex([], undefined, [], [], [], [], {}, [archived]));
    expect(parsed.archive).toEqual([archived]);
    expect(parsed.notes).toEqual([]);
  });

  it("persists calculator contents inside the archived entry after its board key is pruned", () => {
    const calculator = note("calc", 0, "calculator");
    calculator.name = "Budget";
    replaceBoard([calculator]);
    const data = { entries: [{ id: "e", expression: "2 + 3" }], bank: null, rows: [] };
    setCalculatorData(calculator.name, data);
    archiveNotes([calculator.id]);
    const saved = serializeProjectIndex([], undefined, [], [], [], [], calculators.byKey, archive.entries);
    const parsed = parseProjectIndex(saved);
    expect(parsed.calculators).toEqual({});
    expect(parsed.archive[0].calculatorData).toEqual(data);
  });

  it("skips invalid archive entries and edges with a warning", () => {
    const valid = entry(note("A"), [link("ab", "A", "B")]);
    const invalidEdge = link("bad", "X", "Y");
    const result = sanitizeArchiveEntries([{ ...valid, links: [...valid.links, invalidEdge] }, { ...valid, id: "duplicate" }]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].links.map((edge) => edge.id)).toEqual(["ab"]);
    expect(result.warnings).toHaveLength(1);
  });
});
