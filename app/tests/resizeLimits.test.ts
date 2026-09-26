import { describe, expect, it } from "vitest";
import {
  cacheMinimumTextWidth,
  clearMinimumTextWidth,
  growWidthToTextMinimum,
  maximumResizableHeight,
  minimumWidthForText,
  renderedNoteBodyElement,
  RESIZE_EXTRA_LINES,
} from "../src/notes/layout.svelte";
import { resizeNote } from "../src/selection/resize";

describe("manual note height limit", () => {
  it("measures the calculator's custom body when calculating its resize limit", () => {
    const calculatorBody = {} as HTMLElement;
    let requestedSelector = "";
    const content = {
      querySelector: (selector: string) => {
        requestedSelector = selector;
        return selector.includes(".calculator-body") ? calculatorBody : null;
      },
    } as unknown as Pick<HTMLElement, "querySelector">;

    expect(renderedNoteBodyElement(content)).toBe(calculatorBody);
    expect(requestedSelector).toContain(".calculator-body");
  });

  it("keeps the minimum 1.5× base height for short content", () => {
    expect(maximumResizableHeight(0, 2, 6)).toBe(9);
    expect(maximumResizableHeight(4, 2, 6)).toBe(14);
  });

  it("allows exactly five rendered lines beyond long natural content", () => {
    const contentHeight = 200;
    const lineHeight = 2.03;
    expect(RESIZE_EXTRA_LINES).toBe(5);
    expect(maximumResizableHeight(contentHeight, lineHeight)).toBeCloseTo(contentHeight + 5 * lineHeight);
  });
});

describe("text-fit width limits", () => {
  it("computes a minimum from the widest natural line and outer chrome, clamped to note limits", () => {
    expect(minimumWidthForText(220, 30, 75, 10)).toBe(25);
    expect(minimumWidthForText(20, 30, 75, 10)).toBe(12);
    expect(minimumWidthForText(900, 30, 75, 10)).toBe(75);
  });

  it("grows to the needed width without shrinking after text deletion", () => {
    expect(growWidthToTextMinimum(24, 42, 75)).toBe(42);
    expect(growWidthToTextMinimum(42, 28, 75)).toBe(42);
    expect(growWidthToTextMinimum(24, 120, 75)).toBe(75);
  });

  it("keeps manual resize above the cached text minimum", () => {
    cacheMinimumTextWidth("fit-resize", 34);
    try {
      const result = resizeNote(
        { id: "fit-resize", x: 10, y: 20, width: 40, height: null, type: "note", maxWidth: 75 },
        6,
        "right",
        { x: -20, y: 0 },
        false,
        10,
      );
      expect(result.width).toBe(34);
    } finally {
      clearMinimumTextWidth("fit-resize");
    }
  });
});
