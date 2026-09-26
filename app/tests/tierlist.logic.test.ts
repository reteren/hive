import { describe, expect, it } from "vitest";
import type { Note } from "../src/model/note";
import { parseTiers } from "../src/model/nodeData";
import { maximumNoteWidthForKind } from "../src/notes/layout.svelte";
import type { TierRow } from "../src/model/nodeData";
import {
  addTierCard,
  areTierHintsDismissed,
  appendTierRow,
  createDefaultTierRows,
  deleteTierCard,
  deleteTierRow,
  moveTierCard,
  markTierHintsDismissed,
  nextTierlistNoteName,
  recolorTierRow,
  renameTierRow,
  reorderTierRow,
  tierCardPreview,
  tierLabelTextColor,
} from "../src/tierlist/logic";

const row = (id: string, name = id, cards: TierRow["cards"] = []): TierRow => ({
  id,
  name,
  color: "#555555",
  cards,
});

describe("Tierlist data", () => {
  it("starts with the seven saturated default rows in order", () => {
    let id = 0;
    const rows = createDefaultTierRows(() => `id-${id++}`);
    expect(rows.map(({ name }) => name)).toEqual(["S", "A", "B", "C", "D", "E", "F"]);
    expect(rows.map(({ color }) => color)).toEqual([
      "#FF4B5C", "#FFB347", "#FFE66D", "#C3FF68", "#7DFFB3", "#5CD8FF", "#9F8BFF",
    ]);
    expect(new Set(rows.map(({ id }) => id)).size).toBe(7);
    expect(rows.every(({ color }) => tierLabelTextColor(color) === "#202126")).toBe(true);
  });

  it("keeps legacy dark tier labels readable", () => {
    expect(tierLabelTextColor("#8e3d46")).toBe("#f6f4f1");
  });

  it("finds the lowest unused number for a Tierlist note", () => {
    expect(nextTierlistNoteName(["Tierlist note #1", "Tierlist note #3"])).toBe("Tierlist note #2");
    expect(nextTierlistNoteName(["tierlist NOTE #1"])).toBe("Tierlist note #2");
  });

  it("persists dismissed hints across rows, later row additions, and tier parsing", () => {
    const dismissed = markTierHintsDismissed([row("s"), row("a")]);
    expect(dismissed.every(({ hintsDismissed }) => hintsDismissed)).toBe(true);
    expect(areTierHintsDismissed(dismissed)).toBe(true);

    const withNewRow = appendTierRow(dismissed, "New tier", "#545b68", "new");
    expect(withNewRow[2].hintsDismissed).toBe(true);

    const loaded = parseTiers(JSON.parse(JSON.stringify(withNewRow)));
    expect(loaded?.every(({ hintsDismissed }) => hintsDismissed)).toBe(true);
  });

  it("caps every R5 node at 2.5 times its own creation width", () => {
    expect(maximumNoteWidthForKind("tierlist")).toBe(150);
    expect(maximumNoteWidthForKind("calculator")).toBe(100);
    expect(maximumNoteWidthForKind("goal")).toBe(75);
  });

  it("adds, renames, recolours, reorders, and deletes rows", () => {
    const initial = [row("s", "S"), row("a", "A"), row("b", "B")];
    const added = appendTierRow(initial, "New tier", "#545b68", "new");
    expect(added.map(({ name }) => name)).toEqual(["S", "A", "B", "New tier"]);
    const renamed = renameTierRow(added, "new", "Archive");
    const recoloured = recolorTierRow(renamed, "new", "#806030");
    expect(recoloured[3]).toMatchObject({ name: "Archive", color: "#806030" });
    expect(reorderTierRow(recoloured, "b", 0).map(({ id }) => id)).toEqual(["b", "s", "a", "new"]);
    expect(deleteTierRow(recoloured, "a", "delete-cards")?.map(({ id }) => id)).toEqual(["s", "b", "new"]);
  });

  it("moves cards within and between rows without duplicating them", () => {
    const initial = [
      row("a", "A", [
        { id: "one", kind: "text", text: "one" },
        { id: "two", kind: "text", text: "two" },
        { id: "three", kind: "text", text: "three" },
      ]),
      row("b", "B"),
    ];
    const reordered = moveTierCard(initial, "a", "one", "a", 3);
    expect(reordered[0].cards.map(({ id }) => id)).toEqual(["two", "three", "one"]);
    const moved = moveTierCard(reordered, "a", "one", "b");
    expect(moved[0].cards.map(({ id }) => id)).toEqual(["two", "three"]);
    expect(moved[1].cards.map(({ id }) => id)).toEqual(["one"]);
    expect(deleteTierCard(moved, "b", "one")[1].cards).toEqual([]);
    expect(initial[0].cards.map(({ id }) => id)).toEqual(["one", "two", "three"]);
  });

  it("moves a deleted row's cards down, deletes cards only by explicit choice, or cancels", () => {
    const initial = [
      row("a", "A", [{ id: "one", kind: "text", text: "one" }]),
      row("b", "B", [{ id: "two", kind: "text", text: "two" }]),
      row("c", "C"),
    ];
    expect(deleteTierRow(initial, "a", "move-below")?.[0].cards.map(({ id }) => id)).toEqual(["one", "two"]);
    expect(deleteTierRow(initial, "a", "delete-cards")?.[0].cards.map(({ id }) => id)).toEqual(["two"]);
    expect(deleteTierRow(initial, "a", "cancel")).toBeNull();
    expect(deleteTierRow(initial.slice(0, 2), "b", "move-below")).toBeNull();
  });

  it("uses live note name/text and keeps a visible content-missing card after deletion", () => {
    const source = {
      id: "source", type: "note", name: "Changed name", text: "first\nsecond\nthird\nfourth",
      x: 0, y: 0, width: 30, height: null,
    } as Note;
    const card = { id: "preview", kind: "note" as const, noteId: "source" };
    expect(tierCardPreview(card, { source })).toEqual({
      kind: "note", name: "Changed name", lines: ["first", "second", "third"], missing: false,
    });
    expect(tierCardPreview(card, {})).toEqual({
      kind: "note", name: "content missing", lines: [], missing: true,
    });
  });

  it("adds a card by immutable copy", () => {
    const initial = [row("s")];
    const next = addTierCard(initial, "s", { id: "text", kind: "text", text: "hello" });
    expect(next[0].cards).toEqual([{ id: "text", kind: "text", text: "hello" }]);
    expect(initial[0].cards).toEqual([]);
  });
});
