import { describe, expect, it } from "vitest";
import { maximumResizableHeight, RESIZE_EXTRA_LINES } from "../src/notes/layout.svelte";

describe("manual note height limit", () => {
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
