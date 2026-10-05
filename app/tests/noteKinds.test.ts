import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { creationMenu } from "../src/notes/creation.svelte";
import { createNoteKind, createTaskNote, DEFAULT_MINI_NOTE_WIDTH } from "../src/notes/noteCommands";
import { editing } from "../src/notes/editing.svelte";
import { clear, history, redo, undo } from "../src/history/history.svelte";
import { replaceBoard, board } from "../src/model/board.svelte";
import { replaceLinks } from "../src/model/links.svelte";
import { selection, clearSelection } from "../src/selection/selection.svelte";
import { grid } from "../src/board/grid.svelte";
import type { Note } from "../src/model/note";
import { estimatedCreationHeight } from "../src/notes/creationPosition";

function note(id: string, name: string, x = 0, width = 30, height: number | null = 10): Note {
  return { id, type: "note", name, text: "", x, y: 0, width, height };
}

beforeEach(() => {
  clear();
  replaceBoard([]);
  replaceLinks([]);
  creationMenu.origin = { x: 50, y: 40 };
  grid.snap = false;
  grid.step = 10;
  editing.noteId = null;
  selection.ids = [];
  clearSelection();
});

afterEach(() => {
  clear();
  replaceBoard([]);
  replaceLinks([]);
  editing.noteId = null;
  clearSelection();
});

describe("plus and minus mini-nodes", () => {
  it.each([
    ["pro", "Plus", "Create plus"],
    ["con", "Minus", "Create minus"],
  ] as const)("creates a %s node with its default name, width, text, and timestamp", (kind, baseName, label) => {
    const id = createNoteKind(kind);
    const created = board.notes[id];

    expect(created).toMatchObject({
      id,
      type: kind,
      name: baseName,
      text: "",
      width: DEFAULT_MINI_NOTE_WIDTH,
      height: null,
    });
    expect(hasRandomEdgeGap({
      x: created!.x,
      y: created!.y,
      width: created!.width,
      height: estimatedCreationHeight(created!),
    }, creationMenu.origin)).toBe(true);
    expect(created?.createdAt).toEqual(expect.any(Number));
    expect(editing.noteId).toBe(id);
    expect(selection.ids).toEqual([id]);
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0].label).toBe(label);

    undo();
    expect(selection.ids).toEqual([]);
    redo();
    expect(selection.ids).toEqual([id]);
  });

  it("makes default names unique within the board", () => {
    replaceBoard([note("existing-plus", "Plus"), note("existing-minus", "Minus")]);

    const plusId = createNoteKind("pro");
    const minusId = createNoteKind("con");

    expect(board.notes[plusId]?.name).toBe("Plus 2");
    expect(board.notes[minusId]?.name).toBe("Minus 2");
  });

  it("keeps the menu anchor fixed while repeated creates find nearby free space around a beacon", () => {
    replaceBoard([{
      id: "beacon",
      type: "beacon",
      name: "Beacon",
      text: "",
      x: 50 - 3.6,
      y: 40 - 3.6,
      width: 7.2,
      height: 7.2,
      color: "#e8b030",
    }]);

    const first = createNoteKind("note");
    const second = createNoteKind("note");
    const firstNote = board.notes[first]!;
    const secondNote = board.notes[second]!;
    const firstBounds = { x: firstNote.x, y: firstNote.y, width: firstNote.width, height: estimatedCreationHeight(firstNote) };
    const secondBounds = { x: secondNote.x, y: secondNote.y, width: secondNote.width, height: estimatedCreationHeight(secondNote) };
    const beacon = board.notes.beacon!;

    expect(creationMenu.origin).toEqual({ x: 50, y: 40 });
    expect(firstBounds.x < beacon.x + beacon.width && firstBounds.x + firstBounds.width > beacon.x &&
      firstBounds.y < beacon.y + beacon.height! && firstBounds.y + firstBounds.height > beacon.y).toBe(false);
    expect(secondBounds.x < firstBounds.x + firstBounds.width && secondBounds.x + secondBounds.width > firstBounds.x &&
      secondBounds.y < firstBounds.y + firstBounds.height && secondBounds.y + secondBounds.height > firstBounds.y).toBe(false);
    expect(secondBounds).not.toEqual(firstBounds);
  });

  it("creates a task from the creation flow as one ordinary note Undo step", () => {
    const taskId = createTaskNote();
    const task = board.notes[taskId];

    expect(task).toMatchObject({ type: "note", name: "Note", text: "", task: { done: false, doneAt: null } });
    expect(editing.noteId).toBe(taskId);
    expect(selection.ids).toEqual([taskId]);
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0]).toMatchObject({ label: "Create note", target: "Note" });

    undo();
    expect(board.notes[taskId]).toBeUndefined();
    expect(selection.ids).toEqual([]);
    expect(history.cursor).toBe(0);

    redo();
    expect(board.notes[taskId]?.task).toEqual({ done: false, doneAt: null });
    expect(history.entries).toHaveLength(1);
    expect(history.cursor).toBe(1);
  });
});

function hasRandomEdgeGap(
  frame: { x: number; y: number; width: number; height: number },
  origin: { x: number; y: number },
): boolean {
  const xGap = frame.x > origin.x
    ? frame.x - origin.x
    : frame.x + frame.width < origin.x
      ? origin.x - frame.x - frame.width
      : 0;
  const yGap = frame.y > origin.y
    ? frame.y - origin.y
    : frame.y + frame.height < origin.y
      ? origin.y - frame.y - frame.height
      : 0;
  return [xGap, yGap].some((gap) => gap >= 5 - 1e-9 && gap <= 15 + 1e-9);
}
