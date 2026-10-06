import { describe, expect, it } from "vitest";
import { nextTextWidthAfterEdit, widestNaturalLineWidth } from "../src/editor/textFitWidth";
import { maximumNoteWidthForKind } from "../src/notes/layout.svelte";

describe("text-fit width measurement cache", () => {
  it("measures each distinct source line once per note and font", () => {
    const measured: string[] = [];
    const measure = (line: string) => {
      measured.push(line);
      return line.length * 10;
    };

    expect(widestNaturalLineWidth("fit-cache", "a\nlong\nlong", "14px Test", measure)).toBe(40);
    expect(widestNaturalLineWidth("fit-cache", "long\nb", "14px Test", measure)).toBe(40);
    expect(measured).toEqual(["a", "long", "b"]);

    expect(widestNaturalLineWidth("fit-cache", "long", "bold 14px Test", measure)).toBe(40);
    expect(measured).toEqual(["a", "long", "b", "long"]);
  });

  it("grows only while the first line still fits on one row, up to the limit", () => {
    const maximum = maximumNoteWidthForKind("note");
    expect(maximum).toBe(75);
    // Typing the first line of a node that follows it: grows with the line, caps at the limit.
    expect(nextTextWidthAfterEdit(30, 48, maximum, false, 30)).toBe(48);
    expect(nextTextWidthAfterEdit(30, 120, maximum, false, 29.8)).toBe(maximum);
    // Deleting never shrinks.
    expect(nextTextWidthAfterEdit(48, 20, maximum, false, 48)).toBe(48);
    // Manually fixed width never changes.
    expect(nextTextWidthAfterEdit(48, 75, maximum, true, 48)).toBe(48);
  });

  it("never widens a note whose first line already wraps (existing notes, manually narrowed nodes)", () => {
    const maximum = maximumNoteWidthForKind("note");
    // Debug 28 regression: a 30 u note with a long first paragraph (natural width 140 u) exploded to 75 u on any keystroke.
    expect(nextTextWidthAfterEdit(30, 141, maximum, false, 140)).toBe(30);
    expect(nextTextWidthAfterEdit(30, 75, maximum, false, 31)).toBe(30);
    expect(nextTextWidthAfterEdit(30, 75, maximum, false, null)).toBe(30);
  });
});
