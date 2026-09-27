import { describe, expect, it } from "vitest";
import { hasResizeHandle, resizeNote, RESIZE_EDGES } from "../src/selection/resize";
import type { NoteFrame } from "../src/selection/gestures";

const fixedKinds = ["stats", "progress", "goal", "trash", "archive"] as const;

describe("fixed-size node resize guards", () => {
  it("does not render resize handles for fixed-size kinds", () => {
    for (const kind of fixedKinds) {
      expect(RESIZE_EDGES.every((edge) => !hasResizeHandle(kind, edge))).toBe(true);
    }
  });

  it("keeps direct resize calculations unchanged for fixed-size kinds", () => {
    const frame: NoteFrame = { id: "trash", type: "trash", x: 10, y: 20, width: 40, height: 40 };
    expect(resizeNote(frame, 40, "bottom-right", { x: 30, y: 50 }, false, 10)).toEqual({
      x: 10,
      y: 20,
      width: 40,
      height: 40,
    });
  });
});
