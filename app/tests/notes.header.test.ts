import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clear, history, undo } from "../src/history/history.svelte";
import { board, replaceBoard } from "../src/model/board.svelte";
import type { Note } from "../src/model/note";
import { canRenameNoteHeader, noteMenuItems } from "../src/notes/noteMenu";
import { notePressIntent } from "../src/selection/noteMoveIntent";

function note(height: number | null = 20): Note {
  return { id: "note-1", type: "note", name: "Header test", text: "Body", x: 0, y: 0, width: 30, height };
}

function headerMenuItem(): ReturnType<typeof noteMenuItems>[number] {
  const item = noteMenuItems("note-1").find(({ id }) => id === "notes.toggleHeader");
  if (!item) throw new Error("Hide header menu item was not registered.");
  return item;
}

beforeEach(() => {
  clear();
  replaceBoard([note()]);
});

afterEach(() => {
  clear();
  replaceBoard([]);
});

describe("note header visibility", () => {
  it("requires showing a hidden header before renaming its title", () => {
    expect(canRenameNoteHeader(true)).toBe(false);
    expect(canRenameNoteHeader(undefined)).toBe(true);
    expect(canRenameNoteHeader(false)).toBe(true);
  });

  it("toggles the title strip and its fixed-height space in one Undo step", () => {
    const item = headerMenuItem();
    expect(item.label("note-1")).toBe("Hide header");

    item.run("note-1");
    expect(board.notes["note-1"]).toMatchObject({ headerHidden: true });
    expect(board.notes["note-1"]?.height).toBeCloseTo(17.2);
    expect(history.entries).toHaveLength(1);
    expect(item.label("note-1")).toBe("Show header");

    undo();
    expect(board.notes["note-1"]?.headerHidden).toBeUndefined();
    expect(board.notes["note-1"]?.height).toBe(20);
    expect(item.label("note-1")).toBe("Hide header");
  });

  it("keeps auto-height notes auto-sized and leaves their body draggable", () => {
    replaceBoard([note(null)]);
    headerMenuItem().run("note-1");

    expect(board.notes["note-1"]).toMatchObject({ headerHidden: true, height: null });
    expect(notePressIntent("body", "note-1", null)).toBe("move-candidate");
    expect(notePressIntent("frame", "note-1", null)).toBe("move-candidate");
  });

  it("does not offer a header toggle for beacons, which have no title strip", () => {
    replaceBoard([{ ...note(), type: "beacon", width: 7.2, height: 7.2 }]);
    expect(noteMenuItems("note-1").some(({ id }) => id === "notes.toggleHeader")).toBe(false);
  });
});
