import { afterEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import {
  activeDropTarget,
  clearDropTargetPreview,
  dropOnTarget,
  previewDropTarget,
  registerDropTarget,
} from "../src/selection/dropTargets";

const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  clearDropTargetPreview();
});

describe("board drop target registry", () => {
  it("previews the accepted row and returns one command for the drop", () => {
    let droppedIds: readonly string[] = [];
    cleanups.push(registerDropTarget({
      ownerId: "tierlist",
      accepts: (noteIds, point) => noteIds.length === 1 && point.x > 0
        ? { ownerId: "tierlist", targetId: "tierlist:row-a", payload: { rowId: "row-a" } }
        : null,
      drop: (noteIds, match) => {
        droppedIds = [...noteIds];
        expect(match.payload).toEqual({ rowId: "row-a" });
        return { label: "Add node preview", do: () => {}, undo: () => {} };
      },
    }));

    previewDropTarget(["source"], { x: 5, y: 10 });
    expect(get(activeDropTarget)).toMatchObject({ ownerId: "tierlist", targetId: "tierlist:row-a" });
    expect(dropOnTarget(["source"], { x: 5, y: 10 })?.label).toBe("Add node preview");
    expect(droppedIds).toEqual(["source"]);
    expect(get(activeDropTarget)).toBeNull();
  });

  it("clears previews when the cursor leaves or the target is unmounted", () => {
    const unregister = registerDropTarget({
      ownerId: "tierlist",
      accepts: (_noteIds, point) => point.x > 0 ? { ownerId: "tierlist", targetId: "tierlist:row-a" } : null,
      drop: () => null,
    });
    previewDropTarget(["source"], { x: 1, y: 1 });
    expect(get(activeDropTarget)?.targetId).toBe("tierlist:row-a");
    previewDropTarget(["source"], { x: -1, y: 1 });
    expect(get(activeDropTarget)).toBeNull();
    previewDropTarget(["source"], { x: 1, y: 1 });
    unregister();
    expect(get(activeDropTarget)).toBeNull();
  });
});
