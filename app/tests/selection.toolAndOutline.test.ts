import { describe, expect, it } from "vitest";
import { noteSelectionCornerRadius } from "../src/selection/hitTesting";
import { shouldCancelForLineTool } from "../src/selection/gestures";

describe("selection handles and outlines", () => {
  it("cancels note, group, and zone resize gestures when a line tool activates", () => {
    expect(shouldCancelForLineTool("resize", true)).toBe(true);
    expect(shouldCancelForLineTool("group-scale", true)).toBe(true);
    expect(shouldCancelForLineTool("zone-resize", true)).toBe(true);
    expect(shouldCancelForLineTool("move", true)).toBe(false);
    expect(shouldCancelForLineTool("resize", false)).toBe(false);
  });

  it("scales the note corner radius with zoom and adds the one-pixel outline offset", () => {
    expect(noteSelectionCornerRadius(0.5)).toBe(3.5);
    expect(noteSelectionCornerRadius(1)).toBe(6);
    expect(noteSelectionCornerRadius(3)).toBe(16);
    expect(noteSelectionCornerRadius(Number.NaN)).toBe(6);
  });
});
