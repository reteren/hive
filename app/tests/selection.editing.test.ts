import { describe, expect, it } from "vitest";
import { selectionForEditing } from "../src/selection/editingSelection";

describe("selection while editing note text", () => {
  it("selects an unselected note as it enters editing", () => {
    expect(selectionForEditing({ ids: [], primaryId: null }, "note-a")).toEqual({
      ids: ["note-a"],
      primaryId: "note-a",
    });
  });

  it("keeps the rest of an existing multi-selection when one member is edited", () => {
    expect(selectionForEditing({ ids: ["note-a", "note-b", "note-c"], primaryId: "note-a" }, "note-b"))
      .toEqual({ ids: ["note-a", "note-b", "note-c"], primaryId: "note-b" });
  });

  it("selects only the edited note when it was outside the current selection", () => {
    expect(selectionForEditing({ ids: ["note-a", "note-b"], primaryId: "note-b" }, "note-c"))
      .toEqual({ ids: ["note-c"], primaryId: "note-c" });
  });
});
