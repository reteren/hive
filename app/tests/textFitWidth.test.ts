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

  it("lets text notes grow to a sensible limit, wraps there, and respects manual widths", () => {
    const maximum = maximumNoteWidthForKind("note");
    expect(maximum).toBe(75);
    expect(nextTextWidthAfterEdit(30, 48, maximum, false)).toBe(48);
    expect(nextTextWidthAfterEdit(48, 20, maximum, false)).toBe(48);
    expect(nextTextWidthAfterEdit(30, 120, maximum, false)).toBe(maximum);
    expect(nextTextWidthAfterEdit(48, 75, maximum, true)).toBe(48);
  });
});
