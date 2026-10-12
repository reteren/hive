import { describe, expect, it } from "vitest";
import { resolveDuplicateNames, uniqueName } from "../src/notes/naming";

describe("uniqueName", () => {
  it("keeps a safe name when it is available", () => {
    expect(uniqueName("Note", [])).toBe("Note");
  });

  it("adds the next suffix for case-insensitive project collisions", () => {
    expect(uniqueName("Name", ["name", "Name 2"])).toBe("Name 3");
  });

  it("replaces Windows-invalid characters and trims forbidden trailing dots and spaces", () => {
    expect(uniqueName(" A/B:C*  ", [])).toBe("A_B_C_");
    expect(uniqueName("Trailing.  ", [])).toBe("Trailing");
  });

  it("protects reserved Windows device names, including names with extensions", () => {
    expect(uniqueName("CON", [])).toBe("CON_");
    expect(uniqueName("aux.md", [])).toBe("aux_.md");
  });

  it("uses a safe default when sanitizing leaves no name", () => {
    expect(uniqueName("", [])).toBe("Note");
  });
});

describe("resolveDuplicateNames", () => {
  const node = (id: string, name: string, createdAt?: number, type = "note") => ({ id, name, type, createdAt }) as
    { id: string; name: string; type: "note"; createdAt?: number };

  it("keeps the oldest name and numbers the others", () => {
    const notes = [node("b", "Note 4", 20), node("a", "note 4", 10), node("c", "Note 4", 30)];
    const renamed = resolveDuplicateNames(notes);
    expect(notes.map((note) => note.name)).toEqual(["Note 4 (1)", "note 4", "Note 4 (2)"]);
    expect(renamed.map(({ from }) => from)).toEqual(["Note 4", "Note 4"]);
  });

  it("is the same in both copies of a merged project", () => {
    const mine = [node("x1", "Idea"), node("y2", "Idea")];
    const theirs = [node("y2", "Idea"), node("x1", "Idea")];
    resolveDuplicateNames(mine);
    resolveDuplicateNames(theirs);
    expect(mine.find((note) => note.id === "y2")?.name).toBe("Idea (1)");
    expect(theirs.find((note) => note.id === "y2")?.name).toBe("Idea (1)");
  });

  it("skips names already taken and leaves calculator mirrors alone", () => {
    const notes = [node("a", "Plan", 1), node("b", "Plan", 2), node("c", "Plan (1)", 3),
      node("d", "Sum", 1, "calculator"), node("e", "Sum", 2, "calculator")];
    resolveDuplicateNames(notes);
    expect(notes.map((note) => note.name)).toEqual(["Plan", "Plan (2)", "Plan (1)", "Sum", "Sum"]);
  });

  it("changes nothing when names are distinct", () => {
    expect(resolveDuplicateNames([node("a", "One"), node("b", "Two")])).toEqual([]);
  });
});
