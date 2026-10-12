import { describe, expect, it } from "vitest";
import { ProjectDirtyTracker } from "../src/project/dirtyTracking";

describe("project dirty tracking", () => {
  it("captures changed ids and acknowledges only the saved versions", () => {
    const tracker = new ProjectDirtyTracker();
    tracker.markNotes(["a", "b"]);
    const saved = tracker.capture(["a", "b", "c"]);
    expect(saved.noteIds).toEqual(["a", "b"]);

    tracker.markNotes(["a"]);
    tracker.acknowledge(saved);
    expect(tracker.capture(["a", "b", "c"]).noteIds).toEqual(["a"]);
  });

  it("captures all live and previously saved ids after a board replacement", () => {
    const tracker = new ProjectDirtyTracker();
    tracker.markNotes(null);
    expect(tracker.capture(["live-a", "live-b", "deleted-a"]).noteIds).toEqual(["live-a", "live-b", "deleted-a"]);
  });

  it("tracks project-level index changes independently", () => {
    const tracker = new ProjectDirtyTracker();
    tracker.markIndex();
    expect(tracker.hasChanges()).toBe(true);
    const saved = tracker.capture([]);
    tracker.acknowledge(saved);
    expect(tracker.hasChanges()).toBe(false);
  });
});
