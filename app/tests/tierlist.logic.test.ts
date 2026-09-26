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
  pointerDragThresholdPassed,
  recolorTierRow,
  renameTierRow,
  reorderTierRow,
  tierCardPreview,
  tierLabelTextColor,
  type TierRowDropGeometry,
  tierCardDropTargetAt,
  tierCardInsertionIndicatorAt,
  tierRowInsertionIndexAt,
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

  it("computes card and row insertion positions from pointer geometry", () => {
    const geometry = [
      {
        rowId: "top",
        rect: { left: 0, top: 0, right: 220, bottom: 80 },
        cards: [
          { cardId: "one", rect: { left: 60, top: 10, right: 100, bottom: 50 } },
          { cardId: "two", rect: { left: 110, top: 10, right: 150, bottom: 50 } },
        ],
      },
      { rowId: "below", rect: { left: 0, top: 81, right: 220, bottom: 161 }, cards: [] },
    ];
    expect(tierCardDropTargetAt({ x: 105, y: 30 }, geometry)).toEqual({ rowId: "top", index: 1 });
    expect(tierCardDropTargetAt({ x: 145, y: 30 }, geometry)).toEqual({ rowId: "top", index: 2 });
    expect(tierCardDropTargetAt({ x: 200, y: 100 }, geometry)).toEqual({ rowId: "below", index: 0 });
    expect(tierCardDropTargetAt({ x: 250, y: 30 }, geometry)).toBeNull();
    expect(tierRowInsertionIndexAt(39, geometry)).toBe(0);
    expect(tierRowInsertionIndexAt(45, geometry)).toBe(1);
    expect(tierRowInsertionIndexAt(200, geometry)).toBe(2);
  });

  it("keeps the card insertion indicator in Tierlist node units at every zoom", () => {
    const indicatorAtZoom = (zoom: number) => {
      const root = { left: 120, top: 80, right: 420, bottom: 380 };
      const rectAtZoom = (rect: TierRowDropGeometry["rect"]) => ({
        left: root.left + rect.left * zoom,
        top: root.top + rect.top * zoom,
        right: root.left + rect.right * zoom,
        bottom: root.top + rect.bottom * zoom,
      });
      const geometry: TierRowDropGeometry[] = [{
        rowId: "target",
        rect: rectAtZoom({ left: 0, top: 0, right: 300, bottom: 90 }),
        cards: [
          { cardId: "one", rect: rectAtZoom({ left: 65, top: 16, right: 157, bottom: 72 }) },
          { cardId: "two", rect: rectAtZoom({ left: 162, top: 16, right: 254, bottom: 72 }) },
        ],
      }];
      return tierCardInsertionIndicatorAt(
        { rowId: "target", index: 1 },
        geometry,
        rectAtZoom({ left: 52, top: 0, right: 300, bottom: 90 }),
        { ...rectAtZoom({ left: 0, top: 0, right: 300, bottom: 300 }) },
        zoom,
        zoom,
      );
    };

    const lowZoom = indicatorAtZoom(0.35);
    const highZoom = indicatorAtZoom(1.8);
    expect(lowZoom).not.toBeNull();
    expect(highZoom).not.toBeNull();
    expect(lowZoom?.left).toBeCloseTo(158);
    expect(lowZoom?.top).toBeCloseTo(16);
    expect(lowZoom?.width).toBeCloseTo(3);
    expect(lowZoom?.height).toBeCloseTo(56);
    expect(highZoom?.left).toBeCloseTo(lowZoom!.left);
    expect(highZoom?.top).toBeCloseTo(lowZoom!.top);
    expect(highZoom?.width).toBeCloseTo(lowZoom!.width);
    expect(highZoom?.height).toBeCloseTo(lowZoom!.height);
  });

  it("starts a pointer drag only after four pixels and leaves short motion cancellable", () => {
    expect(pointerDragThresholdPassed({ x: 10, y: 10 }, { x: 13, y: 10 })).toBe(false);
    expect(pointerDragThresholdPassed({ x: 10, y: 10 }, { x: 14, y: 10 })).toBe(true);
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
