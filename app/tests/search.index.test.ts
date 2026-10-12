import { describe, expect, it } from "vitest";
import { SearchIndex } from "../src/search/matching";
import { NameIndex } from "../src/search/nameIndex";

describe("incremental search indexes", () => {
  it("finds normalized name, text, and kind matches in board order", () => {
    const index = new SearchIndex([
      { id: "later", name: "Cafe", text: "", createdAt: 2, type: "note" },
      { id: "first", name: "Other", text: "A café on the corner", createdAt: 1, type: "time", task: true },
    ], ["first", "later"]);

    expect(index.search("CAFÉ").map(({ noteId, kind }) => [noteId, kind])).toEqual([
      ["later", "name"],
      ["first", "text"],
    ]);
    expect(index.search("tas").map(({ noteId, kind }) => [noteId, kind])).toEqual([["first", "kind"]]);
  });

  it("updates only the changed note and removes stale postings", () => {
    const index = new SearchIndex([
      { id: "a", name: "Old title", text: "before", type: "note" },
      { id: "b", name: "Keep", text: "unchanged", type: "note" },
    ]);

    index.upsert({ id: "a", name: "New title", text: "after", type: "note" });
    expect(index.search("old")).toEqual([]);
    expect(index.search("after").map((result) => result.noteId)).toEqual(["a"]);
    index.remove("a");
    expect(index.search("after")).toEqual([]);
    expect(index.search("unchanged").map((result) => result.noteId)).toEqual(["b"]);
  });

  it("tracks name postings across renames and preserves locale substring matching", () => {
    const index = new NameIndex([
      { id: "a", name: "Alpha" },
      { id: "b", name: "Beta" },
    ]);

    expect(index.matchingIds("PH")).toEqual(["a"]);
    index.upsert({ id: "a", name: "Gamma" });
    expect(index.matchingIds("pha")).toEqual([]);
    expect(index.matchingIds("GAM")).toEqual(["a"]);
    index.remove("a");
    expect(index.matchingIds("gam")).toEqual([]);
  });
});
