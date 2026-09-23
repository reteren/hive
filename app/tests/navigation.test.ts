import { beforeEach, describe, expect, it } from "vitest";
import { camera } from "../src/board/camera.svelte";
import { clear as clearUndoHistory, execute, history, redo, undo } from "../src/history/history.svelte";
import { replaceBoard, updateNote } from "../src/model/board.svelte";
import type { Note } from "../src/model/note";
import { editing } from "../src/notes/editing.svelte";
import { selection } from "../src/selection/selection.svelte";
import { canNavigateBack, canNavigateForward, clearNavigationHistory } from "../src/navigation/navigationHistory.svelte";
import { teleportToObject, teleportToPoint } from "../src/navigation/navigate";
import { runCommand } from "../src/commands/registry.svelte";

const note: Note = {
  id: "note-1",
  type: "note",
  name: "Target note",
  text: "body",
  x: 5,
  y: 8,
  width: 14,
  height: 10,
};

describe("teleports", () => {
  beforeEach(() => {
    clearUndoHistory();
    clearNavigationHistory();
    replaceBoard([note]);
    selection.ids = [];
    selection.primaryId = null;
    editing.noteId = null;
    camera.x = 120;
    camera.y = -34;
    camera.zoom = 1.75;
  });

  it("records a teleport and restores the exact camera on undo and redo", () => {
    teleportToPoint({ x: 12.5, y: 90 }, { label: "Go to point" });

    expect({ x: camera.x, y: camera.y, zoom: camera.zoom }).toEqual({ x: 12.5, y: 90, zoom: 1.75 });
    expect(history.entries.at(-1)).toMatchObject({ label: "Go to point", target: "12.5, 90" });
    expect(undo()).toBeDefined();
    expect({ x: camera.x, y: camera.y, zoom: camera.zoom }).toEqual({ x: 120, y: -34, zoom: 1.75 });
    expect(redo()).toBeDefined();
    expect({ x: camera.x, y: camera.y, zoom: camera.zoom }).toEqual({ x: 12.5, y: 90, zoom: 1.75 });
  });

  it("centres and selects a note by its bounds", () => {
    expect(teleportToObject(note.id, { label: "Objects panel" })).toBe(true);
    expect({ x: camera.x, y: camera.y }).toEqual({ x: 12, y: 13 });
    expect(selection.ids).toEqual([note.id]);
    expect(selection.primaryId).toBe(note.id);
    expect(history.entries.at(-1)).toMatchObject({ target: note.name });
  });

  it("returns false for a missing object", () => {
    expect(teleportToObject("missing", { label: "Objects panel" })).toBe(false);
    expect(history.entries).toHaveLength(0);
    expect({ x: camera.x, y: camera.y, zoom: camera.zoom }).toEqual({ x: 120, y: -34, zoom: 1.75 });
  });

  it("does not record or add navigation entries when record is false", () => {
    teleportToPoint({ x: 1, y: 2 }, { label: "Silent jump", record: false });

    expect(history.entries).toHaveLength(0);
    expect(canNavigateBack()).toBe(false);
    expect(canNavigateForward()).toBe(false);
    expect({ x: camera.x, y: camera.y, zoom: camera.zoom }).toEqual({ x: 1, y: 2, zoom: 1.75 });
  });

  it("keeps teleports in sequence with board Undo steps", () => {
    execute({
      label: "Move note",
      target: note.name,
      do: () => updateNote(note.id, { x: 25 }),
      undo: () => updateNote(note.id, { x: note.x }),
    });
    const cameraBeforeTeleport = { x: camera.x, y: camera.y, zoom: camera.zoom };

    teleportToPoint({ x: 9, y: 14 }, { label: "Search" });
    expect(history.entries).toHaveLength(2);
    undo();
    expect({ x: camera.x, y: camera.y, zoom: camera.zoom }).toEqual(cameraBeforeTeleport);
    expect(history.cursor).toBe(1);
    undo();
    expect(history.cursor).toBe(0);
    expect(history.entries[0]?.label).toBe("Move note");
  });

  it("navigates back and forward without recording new Undo steps", () => {
    const initial = { x: camera.x, y: camera.y, zoom: camera.zoom };
    teleportToPoint({ x: 10, y: 15 }, { label: "Search" });
    teleportToPoint({ x: -5, y: 8 }, { label: "Search" });
    const undoCount = history.entries.length;

    runCommand("navigation.back");
    expect({ x: camera.x, y: camera.y }).toEqual({ x: 10, y: 15 });
    runCommand("navigation.back");
    expect({ x: camera.x, y: camera.y, zoom: camera.zoom }).toEqual(initial);
    runCommand("navigation.forward");
    expect({ x: camera.x, y: camera.y }).toEqual({ x: 10, y: 15 });
    expect(history.entries).toHaveLength(undoCount);
  });
});
