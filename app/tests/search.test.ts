import { describe, expect, it } from "vitest";
import {
  cycleSearchIndex,
  extractSnippet,
  reconcileSearchIndex,
  searchNotes,
  splitSearchMatch,
  type SearchResult,
} from "../src/search/matching";

describe("note search matching", () => {
  it("matches names and text without case or diacritic sensitivity, including Cyrillic", () => {
    const notes = [
      { id: "latin", name: "Café Notes", text: "Meet at the café", createdAt: 1 },
      { id: "russian", name: "Планы", text: "Ёжик нашёл ёлку", createdAt: 2 },
    ];

    expect(searchNotes("CAFE", notes).map((result) => [result.noteId, result.kind])).toEqual([
      ["latin", "name"],
      ["latin", "text"],
    ]);
    expect(searchNotes("ежик", notes).map((result) => [result.noteId, result.kind])).toEqual([
      ["russian", "text"],
    ]);
    expect(searchNotes("елку", notes).map((result) => result.noteId)).toEqual(["russian"]);
  });

  it("keeps name and text hits in distinct categories", () => {
    const results = searchNotes("orbit", [
      { id: "both", name: "Orbit plan", text: "An orbit is visible", createdAt: 1 },
      { id: "text", name: "Other", text: "Orbit path", createdAt: 2 },
    ]);

    expect(results.map(({ noteId, kind }) => `${kind}:${noteId}`)).toEqual([
      "name:both",
      "text:both",
      "text:text",
    ]);
  });

  it("extracts a short snippet with a precise highlight range", () => {
    const text = "opening words before TARGET and a few words after the match";
    const start = text.indexOf("TARGET");
    const snippet = extractSnippet(text, start, start + "TARGET".length, 24);
    const result: SearchResult = {
      noteId: "n1",
      noteName: "Example",
      kind: "text",
      ...snippet,
    };

    expect(snippet.snippet).toMatch(/^….*TARGET.*…$/);
    expect(splitSearchMatch(result)).toEqual({ before: "…s before ", match: "TARGET", after: " and a fe…" });
  });

  it("orders dated results by creation time and legacy notes by board order afterward", () => {
    const notes = [
      { id: "legacy-a", name: "A", text: "needle", createdAt: undefined },
      { id: "late", name: "B", text: "needle", createdAt: 40 },
      { id: "legacy-b", name: "C", text: "needle", createdAt: undefined },
      { id: "early", name: "D", text: "needle", createdAt: 10 },
    ];

    expect(searchNotes("needle", notes, ["legacy-b", "late", "legacy-a", "early"]).map((result) => result.noteId)).toEqual([
      "early",
      "late",
      "legacy-b",
      "legacy-a",
    ]);
  });

  it("cycles through results in both directions and wraps around", () => {
    expect(cycleSearchIndex(0, -1, 3)).toBe(2);
    expect(cycleSearchIndex(2, 1, 3)).toBe(0);
    expect(cycleSearchIndex(4, 1, 0)).toBe(0);
  });

  it("advances to the next result when the current note is deleted", () => {
    const previous = [result("first"), result("deleted"), result("next")];
    const next = [previous[0], previous[2]];
    const nextIndex = reconcileSearchIndex(previous, 1, next);

    expect(next[nextIndex]?.noteId).toBe("next");
  });
});

function result(noteId: string): SearchResult {
  return {
    noteId,
    noteName: noteId,
    kind: "text",
    snippet: "needle",
    matchStart: 0,
    matchEnd: 6,
  };
}
