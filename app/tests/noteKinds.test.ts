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
  tool.lineShape = "straight";
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
      x: 50 - DEFAULT_MINI_NOTE_WIDTH / 2,
      y: 40 - 3,
      width: DEFAULT_MINI_NOTE_WIDTH,
      height: null,
    });
    expect(created?.createdAt).toEqual(expect.any(Number));
    expect(editing.noteId).toBe(id);
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0].label).toBe(label);
  });

  it("makes default names unique within the board", () => {
    replaceBoard([note("existing-plus", "Plus"), note("existing-minus", "Minus")]);

    const plusId = createNoteKind("pro");
    const minusId = createNoteKind("con");

    expect(board.notes[plusId]?.name).toBe("Plus 2");
    expect(board.notes[minusId]?.name).toBe("Minus 2");
  });

  it("quick-adds a nearby strong child link as one undo and redo step", () => {
    replaceBoard([
      note("parent", "Parent"),
      note("blocker", "Blocker", 32, 20),
    ]);

    const childId = addMiniNode("parent", "pro");
    const child = childId ? board.notes[childId] : undefined;
    const [link] = Object.values(links.byId);

    expect(child).toMatchObject({ type: "pro", name: "Plus", x: 52, y: 0, width: DEFAULT_MINI_NOTE_WIDTH });
    expect(link).toMatchObject({ from: "parent", to: childId, kind: "strong", shape: "straight" });
    expect(history.entries).toHaveLength(1);
    expect(history.cursor).toBe(1);
    expect(history.entries[0]).toMatchObject({ label: "Add plus", target: "Parent → Plus" });

    undo();
    expect(board.notes[childId!]).toBeUndefined();
    expect(links.byId[link.id]).toBeUndefined();
    expect(board.notes.parent).toBeDefined();
    expect(history.cursor).toBe(0);

    redo();
    expect(board.notes[childId!]).toEqual(child);
    expect(links.byId[link.id]).toEqual(link);
    expect(history.cursor).toBe(1);
  });
});
