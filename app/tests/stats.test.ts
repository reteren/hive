import { describe, expect, it } from "vitest";
import type { Note } from "../src/model/note";
import { summarizeTextStatistics } from "../src/stats/statistics";

function textNote(id: string, type: Note["type"], text: string, task = false): Note {
  return {
    id,
    type,
    name: id,
    text,
    x: 0,
    y: 0,
    width: 30,
    height: null,
    ...(task ? { task: { done: false, doneAt: null } } : {}),
  };
}

describe("text statistics", () => {
  it("counts words, Unicode code points, and lines from text notes and task text", () => {
    const notes = {
      ordinary: textNote("ordinary", "note", "one two\n😀"),
      plus: textNote("plus", "pro", "x", true),
      minus: textNote("minus", "con", "can't re-enter"),
    };
    expect(summarizeTextStatistics(Object.keys(notes), notes)).toEqual({
      words: 5,
      characters: 24,
      lines: 4,
      noteCount: 3,
    });
  });

  it("excludes calculators, tierlists, beacons and modules, and deduplicates IDs", () => {
    const notes = {
      text: textNote("text", "note", "hello"),
      calculator: textNote("calculator", "calculator", "hidden words"),
      tierlist: textNote("tierlist", "tierlist", "hidden too"),
      beacon: textNote("beacon", "beacon", "hidden"),
      module: textNote("module", "importance", "hidden"),
    };
    expect(summarizeTextStatistics(["text", "text", "calculator", "tierlist", "beacon", "module"], notes))
      .toEqual({ words: 1, characters: 5, lines: 1, noteCount: 1 });
  });

  it("treats empty note text as zero lines", () => {
    expect(summarizeTextStatistics(["empty"], { empty: textNote("empty", "note", "") }))
      .toEqual({ words: 0, characters: 0, lines: 0, noteCount: 1 });
  });
});
