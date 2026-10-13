import { describe, expect, it } from "vitest";
import {
  CREATE_CATEGORIES,
  CREATE_ITEM_IDS,
  normalizeCreateMenuPreferences,
  searchCreateItems,
  visibleRecentCreateItems,
  withRecentCreateItem,
} from "../src/notes/createMenuCatalog";
import {
  createMenuPreferences,
  isStarredCreateItem,
  recordCreatedItem,
  setCreateMenuPreferences,
  toggleStarredCreateItem,
} from "../src/notes/createMenuPreferences.svelte";

describe("Q menu catalog", () => {
  it("puts every item except Note in exactly one category", () => {
    const grouped = CREATE_CATEGORIES.flatMap((category) => category.items);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual(CREATE_ITEM_IDS.filter((id) => id !== "note").sort());
    expect(CREATE_CATEGORIES.map((category) => category.label)).toEqual(["Tasks", "Marks", "Time", "Media", "Tools", "Board"]);
  });

  it("finds items by label prefix first, then by words and keywords", () => {
    expect(searchCreateItems("cal")).toEqual(["calendar", "calculator"]);
    expect(searchCreateItems("pi")[0]).toBe("image");
    expect(searchCreateItems("timer")).toEqual(["time"]);
    expect(searchCreateItems("choice")).toEqual(["random"]);
    expect(searchCreateItems("  ")).toEqual([]);
    expect(searchCreateItems("zzz")).toEqual([]);
  });

  it("keeps three recent items, newest first, without Note or starred ones", () => {
    let recent = withRecentCreateItem([], "map");
    recent = withRecentCreateItem(recent, "list");
    recent = withRecentCreateItem(recent, "note");
    recent = withRecentCreateItem(recent, "goal");
    recent = withRecentCreateItem(recent, "map");
    recent = withRecentCreateItem(recent, "pdf");
    expect(recent).toEqual(["pdf", "map", "goal"]);
    expect(visibleRecentCreateItems({ starred: ["map"], recent })).toEqual(["pdf", "goal"]);
  });

  it("normalizes saved preferences", () => {
    expect(normalizeCreateMenuPreferences({ starred: ["note", "time", 5, "time", "bogus"], recent: "x" }))
      .toEqual({ starred: ["time"], recent: [] });
    expect(normalizeCreateMenuPreferences(null)).toEqual({ starred: [], recent: [] });
  });

  it("stars and unstars items in the order they were starred", () => {
    setCreateMenuPreferences({});
    toggleStarredCreateItem("calendar");
    toggleStarredCreateItem("image");
    toggleStarredCreateItem("note");
    expect(createMenuPreferences.starred).toEqual(["calendar", "image"]);
    expect(isStarredCreateItem("image")).toBe(true);
    toggleStarredCreateItem("calendar");
    expect(createMenuPreferences.starred).toEqual(["image"]);
    recordCreatedItem("tierlist");
    expect(createMenuPreferences.recent).toEqual(["tierlist"]);
  });
});
