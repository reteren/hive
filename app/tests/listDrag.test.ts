import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import { board, replaceBoard, updateNote } from "../src/model/board.svelte";
import { replaceZones } from "../src/model/zones.svelte";
import { rectContour, type Zone } from "../src/model/zone";
import { R5_KINDS, R6_KINDS, R7_KINDS, type Note, type NoteKind } from "../src/model/note";
import type { ListItem } from "../src/model/nodeData";
import { clear, execute, history, redo, undo } from "../src/history/history.svelte";
import { createContentMoveCommand } from "../src/list/transfers.svelte";
import { listInsertionIndexAt, listItemDisplay } from "../src/list/logic";
import { LIST_ICONS, listItemKind } from "../src/list/icons";
import { beginContentDrag, clearContentDrag, contentDragPreview, previewContentDrop, registerContentDropTarget, type ContentSource, type ContentTarget } from "../src/list/itemDrag";
import { tierCardPreview } from "../src/tierlist/logic";
import { addListTarget } from "../src/list/actions.svelte";

function note(id: string, type: NoteKind = "note", patch: Partial<Note> = {}): Note {
  return { id, type, name: id, text: "", x: 0, y: 0, width: 30, height: null, ...patch };
}
const text = (id: string): ListItem => ({ id, targetId: null, label: id });
const listSource = (itemId: string): ContentSource => ({ kind: "list", noteId: "source", itemId });
const listTarget = (index: number, noteId = "target"): ContentTarget => ({ kind: "list", noteId, index });
const zone: Zone = { id: "zone", name: "Research", color: "#ffffff", parts: [rectContour(0, 0, 100, 100)], holes: [] };

beforeEach(() => {
  clear(); replaceZones([]);
  replaceBoard([note("source", "list", { listItems: [text("a"), text("b"), text("c")] }),
    note("target", "list", { listItems: [text("x")] }), note("node", "note", { text: "First line\nSecond line" }),
    note("tier", "tierlist", { tiers: [{ id: "row", name: "S", color: "#FF4B5C", cards: [] }] })]);
});
afterEach(() => { clear(); replaceBoard([]); replaceZones([]); clearContentDrag(); });

describe("List pointer insertion geometry", () => {
  it("uses remaining-row midpoints, including unequal heights and empty lists", () => {
    expect(listInsertionIndexAt(-10, [26, 40])).toBe(0);
    expect(listInsertionIndexAt(12, [26, 40])).toBe(0);
    expect(listInsertionIndexAt(13, [26, 40])).toBe(1);
    expect(listInsertionIndexAt(47, [26, 40])).toBe(1);
    expect(listInsertionIndexAt(48, [26, 40])).toBe(2);
    expect(listInsertionIndexAt(20, [])).toBe(0);
  });
  it("keeps a pointer in the open gap at the same slot and discounts it below", () => {
    const slot = { index: 1, height: 40 };
    expect(listInsertionIndexAt(30, [26, 26, 26], 2, slot)).toBe(1);
    expect(listInsertionIndexAt(65, [26, 26, 26], 2, slot)).toBe(1);
    expect(listInsertionIndexAt(70, [26, 26, 26], 2, slot)).toBe(1);
    expect(listInsertionIndexAt(85, [26, 26, 26], 2, slot)).toBe(2);
    expect(listInsertionIndexAt(12, [26, 26, 26], 2, slot)).toBe(0);
  });
  it.each([["a", 2, ["b", "c", "a"]], ["c", 0, ["c", "a", "b"]], ["b", 2, ["a", "c", "b"]]] as const)
    ("moves %s to final slot %i in one reversible step", (id, index, expected) => {
      execute(createContentMoveCommand(listSource(id), listTarget(index, "source"))!);
      expect(board.notes.source.listItems!.map((item) => item.id)).toEqual(expected);
      expect(history.entries).toHaveLength(1);
      undo(); expect(board.notes.source.listItems!.map((item) => item.id)).toEqual(["a", "b", "c"]);
      redo(); expect(board.notes.source.listItems!.map((item) => item.id)).toEqual(expected);
    });
  it("makes no history for the original slot or a stale source", () => {
    expect(createContentMoveCommand(listSource("b"), listTarget(1, "source"))).toBeNull();
    expect(createContentMoveCommand(listSource("gone"), listTarget(1))).toBeNull();
    expect(history.entries).toHaveLength(0);
  });
});

describe("List/Tierlist content moves", () => {
  it("moves a row between lists, retaining its reference and saved label, and Undo restores both", () => {
    const item = { id: "linked", targetId: "node", label: "Saved name" };
    updateNote("source", { listItems: [item] });
    execute(createContentMoveCommand(listSource("linked"), listTarget(0))!);
    expect(board.notes.source.listItems).toEqual([]);
    expect(board.notes.target.listItems).toEqual([item, text("x")]);
    expect(history.entries).toHaveLength(1);
    undo(); expect(board.notes.source.listItems).toEqual([item]);
    expect(board.notes.target.listItems).toEqual([text("x")]);
    redo(); expect(board.notes.source.listItems).toEqual([]);
  });
  it("avoids row ID collisions in a receiving List", () => {
    updateNote("target", { listItems: [text("a")] });
    execute(createContentMoveCommand(listSource("a"), listTarget(0))!);
    expect(board.notes.target.listItems!.map((item) => item.label)).toEqual(["a", "a"]);
    expect(new Set(board.notes.target.listItems!.map((item) => item.id)).size).toBe(2);
  });
  it.each([null, "node", "missing"])("converts List reference %s into the right Tier card", (targetId) => {
    const item = { id: "item", targetId, label: "Free text" };
    updateNote("source", { listItems: [item] });
    execute(createContentMoveCommand(listSource("item"), { kind: "tierlist", noteId: "tier", rowId: "row", index: 0 })!);
    const card = board.notes.tier.tiers![0].cards[0];
    expect(card).toMatchObject(targetId === null ? { kind: "text", text: "Free text" } : { kind: "note", noteId: targetId });
    expect(board.notes.source.listItems).toEqual([]);
    expect(board.notes.tier.tiers![0].hintsDismissed).toBe(true);
    expect(history.entries).toHaveLength(1);
    undo(); expect(board.notes.source.listItems).toEqual([item]);
    expect(board.notes.tier.tiers![0].cards).toEqual([]);
    expect(board.notes.tier.tiers![0].hintsDismissed).toBeUndefined();
  });
  it.each(["text", "note"] as const)("moves a %s Tier card to a List and Undo restores both", (kind) => {
    const card = kind === "text" ? { id: "card", kind, text: "Idea" } : { id: "card", kind, noteId: "node" };
    updateNote("tier", { tiers: [{ id: "row", name: "S", color: "#FF4B5C", cards: [card] }] });
    execute(createContentMoveCommand({ kind: "tierlist", noteId: "tier", rowId: "row", cardId: "card" }, listTarget(1))!);
    expect(board.notes.target.listItems![1]).toMatchObject(kind === "text" ? { targetId: null, label: "Idea" } : { targetId: "node", label: "node" });
    expect(board.notes.tier.tiers![0].cards).toEqual([]);
    expect(history.entries).toHaveLength(1);
    undo(); expect(board.notes.target.listItems).toEqual([text("x")]);
    expect(board.notes.tier.tiers![0].cards).toEqual([card]);
  });
  it("rejects a removed destination tier without changing either node", () => {
    expect(createContentMoveCommand(listSource("a"), { kind: "tierlist", noteId: "tier", rowId: "gone", index: 0 })).toBeNull();
    expect(board.notes.source.listItems).toHaveLength(3);
    expect(history.entries).toHaveLength(0);
  });
  it("preserves zone references and live names through a List/Tier round trip", () => {
    replaceZones([zone]);
    expect(addListTarget("source", "zone")).toBe(true);
    const item = board.notes.source.listItems!.at(-1)!;
    expect(listItemDisplay(item, board.notes, { zone })).toEqual({ label: "Research", missing: false });
    execute(createContentMoveCommand(listSource(item.id), { kind: "tierlist", noteId: "tier", rowId: "row", index: 0 })!);
    const card = board.notes.tier.tiers![0].cards[0];
    expect(tierCardPreview(card, board.notes, { zone })).toMatchObject({ name: "Research", missing: false });
    execute(createContentMoveCommand({ kind: "tierlist", noteId: "tier", rowId: "row", cardId: card.id }, listTarget(0))!);
    expect(board.notes.target.listItems![0]).toMatchObject({ targetId: "zone", label: "Research" });
  });
});

describe("List kind icons", () => {
  it("identifies each supported node kind and task, plain text, zone and missing targets", () => {
    const kinds: NoteKind[] = ["note", "pro", "con", "importance", "purpose", "mood", "beacon", ...R5_KINDS, ...R6_KINDS, ...R7_KINDS];
    for (const kind of kinds) {
      expect(listItemKind({ id: "row", targetId: "id", label: "" }, { id: note("id", kind) })).toBe(kind);
      expect(LIST_ICONS[kind].label.length).toBeGreaterThan(0);
      expect(LIST_ICONS[kind].paths.every((path) => path.startsWith("M"))).toBe(true);
    }
    const item = { id: "row", targetId: "id", label: "Saved" };
    expect(listItemKind(item, { id: note("id", "note", { task: { done: false, doneAt: null } }) })).toBe("task");
    expect(listItemKind(text("text"), {})).toBe("text");
    expect(listItemKind({ ...item, targetId: "zone" }, {}, { zone })).toBe("zone");
    expect(listItemKind(item, {})).toBe("missing");
  });
});

describe("content drag previews", () => {
  it("previews List/Tier destinations without mutating content; cancellation clears only the preview", () => {
    const dispose = registerContentDropTarget((point) => point.x > 100 ? { kind: "tierlist", noteId: "tier", rowId: "row", index: 0 } : listTarget(0));
    try {
      beginContentDrag(listSource("a"), 30);
      expect(previewContentDrop({ x: 0, y: 0 })).toEqual(listTarget(0));
      expect(previewContentDrop({ x: 110, y: 0 })?.kind).toBe("tierlist");
      expect(board.notes.source.listItems).toHaveLength(3);
      expect(history.entries).toHaveLength(0);
      clearContentDrag(); expect(get(contentDragPreview)).toBeNull();
    } finally { dispose(); }
  });
});
