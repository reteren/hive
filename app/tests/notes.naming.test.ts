import { describe, expect, it } from "vitest";
import { uniqueName } from "../src/notes/naming";

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
