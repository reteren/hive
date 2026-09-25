import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { creationMenu } from "../src/notes/creation.svelte";
import { addMiniNode, createNoteKind, DEFAULT_MINI_NOTE_WIDTH } from "../src/notes/noteCommands";
import { editing } from "../src/notes/editing.svelte";
import { clear, history, redo, undo } from "../src/history/history.svelte";
import { replaceBoard, board } from "../src/model/board.svelte";
import { links, replaceLinks } from "../src/model/links.svelte";
import { selection, clearSelection } from "../src/selection/selection.svelte";
import { grid } from "../src/board/grid.svelte";
import { tool } from "../src/tools/tool.svelte";
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
  tool.lineShape = "base";
});

afterEach(() => {
  clear();
  replaceBoard([]);
  replaceLinks([]);
  editing.noteId = null;
  clearSelection();
  tool.lineShape = "base";
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
      x: 50 - DEFAULT_MINI_NOTE_WIDTH / 2,
      y: 40 - estimatedCreationHeight({ type: kind, width: DEFAULT_MINI_NOTE_WIDTH, height: null, text: "" }) / 2,
      width: DEFAULT_MINI_NOTE_WIDTH,
      height: null,
    });
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

  it("quick-adds a nearby strong child link as one undo and redo step", () => {
    tool.lineShape = "wave";
    replaceBoard([
      note("parent", "Parent"),
      note("blocker", "Blocker", 32, 20),
    ]);

    const childId = addMiniNode("parent", "pro");
    const child = childId ? board.notes[childId] : undefined;
    const [link] = Object.values(links.byId);

    expect(child).toMatchObject({ type: "pro", name: "Plus", x: 52, y: 0, width: DEFAULT_MINI_NOTE_WIDTH });
    expect(link).toMatchObject({ from: "parent", to: childId, kind: "strong", shape: "base" });
    expect(history.entries).toHaveLength(1);
    expect(history.cursor).toBe(1);
    expect(history.entries[0]).toMatchObject({ label: "Add plus", target: "Parent → Plus" });
    expect(selection.ids).toEqual([childId]);

    undo();
    expect(board.notes[childId!]).toBeUndefined();
    expect(links.byId[link.id]).toBeUndefined();
    expect(board.notes.parent).toBeDefined();
    expect(selection.ids).toEqual([]);
    expect(history.cursor).toBe(0);

    redo();
    expect(board.notes[childId!]).toEqual(child);
    expect(links.byId[link.id]).toEqual(link);
    expect(selection.ids).toEqual([childId]);
    expect(history.cursor).toBe(1);
  });
});
