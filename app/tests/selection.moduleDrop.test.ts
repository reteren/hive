import { describe, expect, it } from "vitest";
import { resolveModuleDropDecision } from "../src/selection/moduleDropDecision";

describe("module drops from move gestures", () => {
  it("inserts a single standalone module instead of recording its Move", () => {
    expect(resolveModuleDropDecision(["importance"], false, true)).toEqual({
      tryInsert: true,
      commitMove: false,
      clearPreview: true,
    });
    expect(resolveModuleDropDecision(["purpose"], false, true).commitMove).toBe(false);
  });

  it("records an ordinary Move when the module drop hook declines the target", () => {
    expect(resolveModuleDropDecision(["importance"], false, false)).toEqual({
      tryInsert: true,
      commitMove: true,
      clearPreview: true,
    });
  });

  it("keeps group moves on the ordinary Move path", () => {
    expect(resolveModuleDropDecision(["importance", "note"], false, true)).toEqual({
      tryInsert: false,
      commitMove: true,
      clearPreview: true,
    });
  });

  it("cancels without trying insertion or committing Move and always clears the preview", () => {
    expect(resolveModuleDropDecision(["importance"], true, true)).toEqual({
      tryInsert: false,
      commitMove: false,
      clearPreview: true,
    });
  });
});
