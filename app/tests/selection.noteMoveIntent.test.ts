import { describe, expect, it } from "vitest";
import {
  noteMoveStarts,
  notePressIntent,
  shouldToggleSelectedHeaderAfterGesture,
} from "../src/selection/noteMoveIntent";

describe("note press move intent", () => {
  it("treats a static body press as a click until the drag threshold is crossed", () => {
    const intent = notePressIntent("body", "note-a", null);
    expect(intent).toBe("move-candidate");
    expect(noteMoveStarts(intent, false)).toBe(false);
    expect(noteMoveStarts(intent, true)).toBe(true);
  });

  it("allows a plain text-link click while letting a drag from that link move its note", () => {
    const intent = notePressIntent("body", "note-a", "note-b");
    expect(noteMoveStarts(intent, false)).toBe(false);
    expect(noteMoveStarts(intent, true)).toBe(true);
  });

  it("keeps text selection inside the active editor and leaves frame handles to resize", () => {
    expect(notePressIntent("body", "note-a", "note-a")).toBe("text-interaction");
    expect(noteMoveStarts("text-interaction", true)).toBe(false);
    expect(notePressIntent("resize-handle", "note-a", "note-a")).toBe("resize");
    expect(notePressIntent("header", "note-a", "note-a")).toBe("move-candidate");
    expect(notePressIntent("frame", "note-a", "note-a")).toBe("move-candidate");
  });

  it("ignores presses outside a note", () => {
    expect(notePressIntent("outside", null, null)).toBe("ignore");
    expect(noteMoveStarts("ignore", true)).toBe(false);
  });

  it("toggles an already selected header on Ctrl-click but keeps it selected for Ctrl-drag", () => {
    expect(shouldToggleSelectedHeaderAfterGesture(false, false)).toBe(true);
    expect(shouldToggleSelectedHeaderAfterGesture(true, false)).toBe(false);
    expect(shouldToggleSelectedHeaderAfterGesture(false, true)).toBe(false);
  });
});
