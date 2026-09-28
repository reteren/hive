import { describe, expect, it } from "vitest";
import { normalizeNoteScale, type Note } from "../src/model/note";
import { noteBounds } from "../src/notes/layout.svelte";
import { creationObstacleForNote } from "../src/notes/creationPosition";
import {
  createResizeGesture,
  framesEqual,
  resizeGestureChange,
  updateResizeGesture,
} from "../src/selection/gestures";
import { mergeLoadedNotes, parseProjectIndex, parseProjectIndexWithWarnings, serializeProjectIndex } from "../src/project/index";
import { sanitizeArchiveEntries } from "../src/archive/serialization";
import { sanitizeTrashEntries } from "../src/trash/serialization";

function note(fields: Partial<Note> = {}): Note {
  return { id: "scaled", type: "note", name: "Scaled", text: "body", x: 10, y: 20, width: 30, height: 20, ...fields };
}

describe("universal node scale", () => {
  it("uses scaled bounds and placement obstacles while keeping model dimensions intact", () => {
    const scaled = note({ scale: 2 });
    expect(noteBounds(scaled)).toEqual({ x: 10, y: 20, width: 60, height: 40 });
    expect(creationObstacleForNote(scaled)).toEqual({ x: 10, y: 20, width: 60, height: 40 });
    expect(scaled).toMatchObject({ width: 30, height: 20, scale: 2 });

    const beacon = note({ type: "beacon", width: 7.2, height: 7.2, scale: 1.5 });
    expect(noteBounds(beacon)).toEqual({ x: 10, y: 20, width: 10.8, height: 10.8 });
  });

  it("uniformly scales locked nodes, anchors the opposite corner, and records scale-only changes", () => {
    const gesture = createResizeGesture(
      { id: "tier", type: "tierlist", x: 10, y: 20, width: 60, height: 40, scale: 1 },
      40,
      "top-left",
      { x: 10, y: 20 },
    );
    const updated = updateResizeGesture(gesture, { x: 0, y: 10 }, false, 1, true);
    expect(updated.after).toMatchObject({ x: -5, y: 10, width: 75, height: 50, scale: 1.25 });
    expect(updated.after.x + updated.after.width).toBe(70);
    expect(updated.after.y + updated.after.height!).toBe(60);
    expect(resizeGestureChange(updated)).not.toBeNull();
    expect(framesEqual([gesture.before], [updated.after])).toBe(false);
  });

  it("keeps scale between 1× and 4× on side handles", () => {
    const frame = { id: "locked", type: "markas" as const, x: 10, y: 20, width: 60, height: 40, scale: 2 };
    const shrink = createResizeGesture(frame, 40, "left", { x: 10, y: 30 });
    const shrunk = updateResizeGesture(shrink, { x: 40, y: 30 }, false, 1, true).after;
    expect(normalizeNoteScale(shrunk.scale)).toBe(1);
    expect(shrunk.x + shrunk.width).toBe(70);

    const grow = createResizeGesture({ ...frame, scale: 3 }, 40, "right", { x: 70, y: 30 });
    expect(updateResizeGesture(grow, { x: 200, y: 30 }, false, 1, true).after.scale).toBe(4);
  });

  it("saves and loads scale in board, archive, and trash data, omitting default scale", () => {
    const scaled = note({ scale: 2.5 });
    const index = parseProjectIndex(serializeProjectIndex([scaled]));
    expect(index.notes[0]?.scale).toBe(2.5);
    expect(mergeLoadedNotes(index, [{ ...scaled, file: index.notes[0]!.file }])[0]?.scale).toBe(2.5);

    const defaultIndex = parseProjectIndex(serializeProjectIndex([note()]));
    expect(defaultIndex.notes[0]?.scale).toBeUndefined();

    const archive = sanitizeArchiveEntries([{ id: "archive-entry", archivedAt: 1, note: scaled, links: [] }]);
    const trash = sanitizeTrashEntries([{ id: "trash-entry", deletedAt: 1, notes: [scaled], zones: [], links: [] }]);
    expect(archive.warnings).toEqual([]);
    expect(trash.warnings).toEqual([]);
    expect(archive.entries[0]?.note.scale).toBe(2.5);
    expect(trash.entries[0]?.notes[0]?.scale).toBe(2.5);
  });

  it("defaults invalid project scale to 1 with a warning and rejects invalid retention snapshots", () => {
    const raw = JSON.parse(serializeProjectIndex([note()])) as { notes: Array<Record<string, unknown>> };
    raw.notes[0]!.scale = 0.5;
    const parsed = parseProjectIndexWithWarnings(JSON.stringify(raw));
    expect(parsed.index.notes[0]?.scale).toBeUndefined();
    expect(parsed.warnings).toContain("Invalid scale for note scaled; defaulted to 1.");

    const invalid = note({ scale: 5 });
    expect(sanitizeArchiveEntries([{ id: "bad-archive", archivedAt: 1, note: invalid, links: [] }]).entries).toEqual([]);
    expect(sanitizeTrashEntries([{ id: "bad-trash", deletedAt: 1, notes: [invalid], zones: [], links: [] }]).entries).toEqual([]);
  });
});
