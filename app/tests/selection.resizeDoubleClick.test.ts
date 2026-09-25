import { describe, expect, it } from "vitest";
import { resizeDoubleClickAction } from "../src/selection/resizeDoubleClick";

describe("resize handle double-click", () => {
  it("opens editing when a top or bottom handle overlaps an editable body", () => {
    expect(resizeDoubleClickAction("top", true)).toBe("edit");
    expect(resizeDoubleClickAction("bottom", true)).toBe("edit");
  });

  it("keeps auto-height reset on the handle outside the body", () => {
    expect(resizeDoubleClickAction("top", false)).toBe("auto-height");
    expect(resizeDoubleClickAction("bottom", false)).toBe("auto-height");
    expect(resizeDoubleClickAction("left", true)).toBe("none");
  });

  it("fits horizontal resize handles to the cached text minimum when enabled", () => {
    expect(resizeDoubleClickAction("left", false)).toBe("auto-width");
    expect(resizeDoubleClickAction("right", false)).toBe("auto-width");
    expect(resizeDoubleClickAction("right", false, true, true, false)).toBe("none");
  });

  it("does not switch standalone modules to auto height", () => {
    expect(resizeDoubleClickAction("top", false, false)).toBe("none");
    expect(resizeDoubleClickAction("bottom", false, false)).toBe("none");
  });

  it("does not auto-height when rendered content metrics exceed the resize limit", () => {
    expect(resizeDoubleClickAction("bottom", false, true, false)).toBe("none");
    expect(resizeDoubleClickAction("bottom", true, true, false)).toBe("edit");
  });
});
