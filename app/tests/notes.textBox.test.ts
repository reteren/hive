import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clear, redo, undo } from "../src/history/history.svelte";
import { board, replaceBoard } from "../src/model/board.svelte";
import type { Note } from "../src/model/note";
import { noteMenuItems } from "../src/notes/noteMenu";
import { serializeProjectIndex, parseProjectIndex } from "../src/project/index";
import { selection } from "../src/selection/selection.svelte";

function note(overrides: Partial<Note> = {}): Note {
  return { id: "note-1", type: "note", name: "Text box test", text: "Keep me", x: 0, y: 0, width: 30, height: 20, ...overrides };
}

function menuItem(id: string, noteId = "note-1") {
  return noteMenuItems(noteId).find((item) => item.id === id);
}

beforeEach(() => {
  clear();
  replaceBoard([note()]);
  selection.ids = [];
});

afterEach(() => {
  clear();
  replaceBoard([]);
  selection.ids = [];
});

describe("Remove text box", () => {
  it("removes the box but keeps the text for when it is shown again", () => {
    expect(menuItem("notes.toggleTextBox")?.label("note-1")).toBe("Remove text box");
    menuItem("notes.toggleTextBox")!.run("note-1");
    expect(board.notes["note-1"]).toMatchObject({ textHidden: true, height: null, text: "Keep me" });

    expect(menuItem("notes.toggleTextBox")?.label("note-1")).toBe("Show text box");
    menuItem("notes.toggleTextBox")!.run("note-1");
    expect(board.notes["note-1"]?.textHidden).toBeUndefined();
    expect(board.notes["note-1"]?.text).toBe("Keep me");
  });

  it("is one Undo step that restores the manual height", () => {
    menuItem("notes.toggleTextBox")!.run("note-1");
    undo();
    expect(board.notes["note-1"]).toMatchObject({ height: 20 });
    expect(board.notes["note-1"]?.textHidden).toBeUndefined();
    redo();
    expect(board.notes["note-1"]?.textHidden).toBe(true);
  });

  it("cannot be combined with a hidden header and only exists on text nodes", () => {
    menuItem("notes.toggleTextBox")!.run("note-1");
    expect(menuItem("notes.toggleHeader")).toBeUndefined();

    replaceBoard([note({ headerHidden: true }), note({ id: "list-1", type: "list" })]);
    expect(menuItem("notes.toggleTextBox")).toBeUndefined();
    expect(menuItem("notes.toggleTextBox", "list-1")).toBeUndefined();
  });

  it("is saved with the project", () => {
    const saved = parseProjectIndex(serializeProjectIndex([note({ textHidden: true, height: null })]));
    expect(saved.notes[0]?.textHidden).toBe(true);
  });
});
