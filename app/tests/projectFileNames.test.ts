import { describe, expect, it } from "vitest";
import { noteFileKey, sanitizeNoteName } from "../src/project/fileNames";

describe("project file names", () => {
  it("replaces Windows-invalid filename characters", () => {
    expect(sanitizeNoteName('A <note> / "draft"')).toBe("A _note_ _ _draft_");
  });

  it("trims trailing dots and spaces and supplies a fallback", () => {
    expect(sanitizeNoteName(" title...  ")).toBe(" title");
    expect(sanitizeNoteName("   ")).toBe("Note");
    expect(sanitizeNoteName("..")).toBe("Note");
  });

  it("suffixes Windows device names", () => {
    for (const reserved of ["CON", "prn", "AUX", "NUL", "COM1", "LPT9"]) {
      expect(sanitizeNoteName(reserved)).toBe(`${reserved}_`);
    }
    expect(sanitizeNoteName("COM¹")).toBe("COM¹_");
    expect(sanitizeNoteName("CON.md")).toBe("CON_.md");
  });

  it("caps the basename length without splitting a surrogate pair", () => {
    const safe = sanitizeNoteName(`${"a".repeat(118)}😀z`);
    expect(safe).toBe(`${"a".repeat(118)}😀`);
    expect(safe.length).toBe(120);
  });

  it("normalizes to NFC and uses a case-insensitive collision key", () => {
    expect(sanitizeNoteName("e\u0301")).toBe("é");
    expect(noteFileKey("Résumé")).toBe(noteFileKey("RÉSUMÉ"));
  });
});
