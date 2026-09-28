import { describe, expect, it } from "vitest";
import { tierDragRows, tierDropOriginalIndex } from "../src/tierlist/dragLayout";
import { moveTierCard, tierCardDropTargetAt, type TierRowDropGeometry } from "../src/tierlist/logic";
import type { TierRow } from "../src/model/nodeData";
import type { ContentDragPreview, ContentSource, ContentTarget } from "../src/list/itemDrag";

const rows: TierRow[] = [
  { id: "a", name: "A", color: "#ffffff", cards: ["one", "two", "three"].map((id) => ({ id, kind: "text", text: id })) },
  { id: "b", name: "B", color: "#ffffff", cards: [] },
];
const source: ContentSource = { kind: "tierlist", noteId: "tier", rowId: "a", cardId: "one" };
const target = (index: number, rowId = "a"): ContentTarget => ({ kind: "tierlist", noteId: "tier", rowId, index });
const preview = (destination: ContentTarget | null): ContentDragPreview => ({ source, target: destination, height: 56, width: 92 });

describe("Tierlist live layout", () => {
  it("opens a real slot and shifts remaining cards without changing persisted rows", () => {
    const before = JSON.stringify(rows);
    const display = tierDragRows(rows, "tier", preview(target(1)));
    expect(display[0].displayCards.map((entry) => entry.card?.id ?? "slot")).toEqual(["two", "slot", "three"]);
    expect(JSON.stringify(rows)).toBe(before);
    expect(tierDragRows(rows, "tier", null)[0].displayCards.map((entry) => entry.card?.id)).toEqual(["one", "two", "three"]);
  });
  it("supports another row and an empty destination, and restores the source preview on cancel", () => {
    const display = tierDragRows(rows, "tier", preview(target(0, "b")));
    expect(display[0].displayCards).toHaveLength(2);
    expect(display[1].displayCards[0].card).toBeNull();
    expect(tierDragRows(rows, "tier", preview(null))[1].displayCards).toEqual([]);
    expect(tierDragRows(rows, "tier", null)[0].displayCards).toHaveLength(3);
  });
  it("opens the target gap for List rows and cross-Tier copies without removing target cards", () => {
    const incoming: ContentDragPreview = { source: { kind: "list", noteId: "list", itemId: "item" }, target: target(1), height: 26 };
    expect(tierDragRows(rows, "tier", incoming)[0].displayCards.map((entry) => entry.card?.id ?? "slot")).toEqual(["one", "slot", "two", "three"]);
    expect(tierDragRows(rows, "other", preview({ kind: "tierlist", noteId: "other", rowId: "a", index: 0 }))[0].displayCards).toHaveLength(4);
  });
  it.each([0, 1, 2])("maps final slot %i back to the existing move command's indices", (index) => {
    const destination = target(index);
    const display = tierDragRows(rows, "tier", preview(destination));
    const expected = display[0].displayCards.map((entry) => entry.card?.id ?? "one");
    const moved = moveTierCard(rows, "a", "one", "a", tierDropOriginalIndex(rows, source, destination));
    expect(moved[0].cards.map((card) => card.id)).toEqual(expected);
  });
  it("keeps indices unchanged across rows, nodes and List-to-Tier conversions", () => {
    expect(tierDropOriginalIndex(rows, source, target(0, "b"))).toBe(0);
    expect(tierDropOriginalIndex(rows, source, { kind: "tierlist", noteId: "other", rowId: "a", index: 1 })).toBe(1);
    expect(tierDropOriginalIndex(rows, { kind: "list", noteId: "list", itemId: "row" }, target(1))).toBe(1);
  });
  it("holds the insertion index while a pointer is inside the open slot, including a wrapped line", () => {
    const geometry: TierRowDropGeometry[] = [{ rowId: "a", rect: { left: 0, top: 0, right: 220, bottom: 130 },
      cards: [
        { cardId: "one", rect: { left: 5, top: 5, right: 97, bottom: 61 } },
        { cardId: "two", rect: { left: 5, top: 66, right: 97, bottom: 122 } },
      ], slot: { index: 1, rect: { left: 102, top: 5, right: 194, bottom: 61 } } }];
    expect(tierCardDropTargetAt({ x: 150, y: 30 }, geometry)).toEqual({ rowId: "a", index: 1 });
    expect(tierCardDropTargetAt({ x: 99, y: 100 }, geometry)).toEqual({ rowId: "a", index: 2 });
  });
});
