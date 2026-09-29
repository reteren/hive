import { describe, expect, it } from "vitest";
import {
  isAltOnlyCandidate,
  overviewFontSize,
  overviewLabelFor,
  overviewTextFits,
  overviewZoneFontSize,
} from "../src/overview/overviewLogic";

describe("overview labels", () => {
  it("shows only the number for default numbered titles", () => {
    expect(overviewLabelFor("note", "Text 12")).toEqual({ kind: "Text", title: "12" });
    expect(overviewLabelFor("note", "Note 2")).toEqual({ kind: "Text", title: "2" });
    expect(overviewLabelFor("note", "Note")).toEqual({ kind: "Text", title: null });
    expect(overviewLabelFor("stats", "Statistics")).toEqual({ kind: "Statistics", title: null });
  });

  it("keeps a custom title beneath the node kind", () => {
    expect(overviewLabelFor("time", "Sprint timer")).toEqual({ kind: "Time", title: "Sprint timer" });
    expect(overviewLabelFor("note", "")).toEqual({ kind: "Text", title: null });
  });

  it("sizes text to the node bounds and hides it when it cannot fit on screen", () => {
    expect(overviewFontSize("Random Choice", "A", 300, 20)).toBeLessThan(14);
    expect(overviewTextFits(300, 60, 1)).toBe(true);
    expect(overviewTextFits(300, 60, 0.1)).toBe(false);
    expect(overviewTextFits(300, 60, 1, 0.5)).toBe(true);
  });

  it("fits zone labels inside their shape and hides tiny labels", () => {
    expect(overviewZoneFontSize("Planning", 40, 20, 1)).toBeGreaterThan(0);
    expect(overviewZoneFontSize("Long zone name", 3, 2, 1)).toBeNull();
  });
});

describe("Alt overview activation", () => {
  const event = (overrides: Partial<KeyboardEvent> = {}) => ({
    key: "Alt",
    code: "AltLeft",
    altKey: true,
    ctrlKey: false,
    shiftKey: false,
    metaKey: false,
    repeat: false,
    ...overrides,
  }) as KeyboardEvent;

  it("accepts only a fresh Alt-alone keydown", () => {
    expect(isAltOnlyCandidate(event())).toBe(true);
    expect(isAltOnlyCandidate(event({ ctrlKey: true }))).toBe(false);
    expect(isAltOnlyCandidate(event({ shiftKey: true }))).toBe(false);
    expect(isAltOnlyCandidate(event({ metaKey: true }))).toBe(false);
    expect(isAltOnlyCandidate(event({ repeat: true }))).toBe(false);
    expect(isAltOnlyCandidate(event({ key: "s", code: "KeyS" }))).toBe(false);
  });
});
