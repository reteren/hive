import { describe, expect, it } from "vitest";
import { parseProjectIndex, projectNoteFiles, serializeProjectIndex } from "../src/project/index";
import type { Note } from "../src/model/note";

const note = (id: string, name: string): Note => ({ id, type: "note", name, text: "", x: 0, y: 0, width: 10, height: null });

describe("note file names (Git-friendly)", () => {
  it("gives a new note its name plus an id piece, so two clones never share a file", () => {
    const mine = projectNoteFiles([note("750e12f1-c8d3", "Note 4")]).get("750e12f1-c8d3");
    const theirs = projectNoteFiles([note("9bfbd4da-6392", "Note 4")]).get("9bfbd4da-6392");
    expect(mine).toBe("Note 4 750e.md");
    expect(theirs).toBe("Note 4 9bfb.md");
  });

  it("keeps an existing file while the name matches, including old files without the id piece", () => {
    const previous = new Map([["a", "Plan.md"], ["b", "Ideas b0c1.md"]]);
    const files = projectNoteFiles([note("a", "Plan"), note("b0c1d2", "Ideas")], new Map([...previous, ["b0c1d2", "Ideas b0c1.md"]]));
    expect(files.get("a")).toBe("Plan.md");
    expect(files.get("b0c1d2")).toBe("Ideas b0c1.md");
  });

  it("renaming a note moves it to a new id-suffixed file", () => {
    const files = projectNoteFiles([note("abcd1234", "Renamed")], new Map([["abcd1234", "Plan.md"]]));
    expect(files.get("abcd1234")).toBe("Renamed abcd.md");
  });

  it("uses a longer id piece when two notes share a name and the first characters of the id", () => {
    const files = projectNoteFiles([note("abcd1111", "Same"), note("abcd2222", "Same")]);
    expect(files.get("abcd1111")).toBe("Same abcd.md");
    expect(files.get("abcd2222")).toBe("Same abcd2.md");
  });

  it("keeps saved files across a save round trip", () => {
    const first = parseProjectIndex(serializeProjectIndex([note("aaaa9999", "Plan")]));
    const legacy = { ...first, notes: first.notes.map((entry) => ({ ...entry, file: "Plan.md" })) };
    const second = parseProjectIndex(serializeProjectIndex([note("aaaa9999", "Plan")], legacy));
    expect(second.notes[0].file).toBe("Plan.md");
  });
});
