import { describe, expect, it } from "vitest";
import {
  noteMoveStarts,
  notePressIntent,
  shouldSelectNoteOnAltPress,
  shouldSuppressAltNodeActivationClick,
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

  it("selects a note for Alt alone while preserving Ctrl/Shift combinations and dimmed-note behavior", () => {
    expect(shouldSelectNoteOnAltPress("note-a", true, false, false, false)).toBe(true);
    expect(shouldSelectNoteOnAltPress("note-a", true, true, false, false)).toBe(false);
    expect(shouldSelectNoteOnAltPress("note-a", true, false, true, false)).toBe(false);
    expect(shouldSelectNoteOnAltPress("note-a", false, false, false, false)).toBe(false);
    expect(shouldSelectNoteOnAltPress(null, true, false, false, false)).toBe(false);
    expect(shouldSelectNoteOnAltPress("dimmed", true, false, false, true)).toBe(false);
  });

  it("suppresses pointer activation after Alt selection without suppressing keyboard clicks", () => {
    expect(shouldSuppressAltNodeActivationClick(150, 100, 1)).toBe(true);
    expect(shouldSuppressAltNodeActivationClick(150, 100, 2)).toBe(true);
    expect(shouldSuppressAltNodeActivationClick(99, 100, 1)).toBe(false);
    expect(shouldSuppressAltNodeActivationClick(150, 100, 0)).toBe(false);
  });
});
