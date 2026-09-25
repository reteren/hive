import { describe, expect, it } from "vitest";
import { widestNaturalLineWidth } from "../src/editor/textFitWidth";

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
});
