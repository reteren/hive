import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clear, history, redo, undo } from "../src/history/history.svelte";
import { board, replaceBoard } from "../src/model/board.svelte";
import type { Note } from "../src/model/note";
import { canRenameNoteHeader, noteMenuItems } from "../src/notes/noteMenu";
import { notePressIntent } from "../src/selection/noteMoveIntent";
import { selection } from "../src/selection/selection.svelte";

const noteNodeSource = Object.values(import.meta.glob<string>("../src/notes/NoteNode.svelte", {
  eager: true,
  query: "?raw",
  import: "default",
}))[0] ?? "";

function note(height: number | null = 20, id = "note-1", headerHidden?: boolean): Note {
  return {
    id,
    type: "note",
    name: id === "note-1" ? "Header test" : id,
    text: "Body",
    x: 0,
    y: 0,
    width: 30,
    height,
    ...(headerHidden === undefined ? {} : { headerHidden }),
  };
}

function headerMenuItem(): ReturnType<typeof noteMenuItems>[number] {
  const item = noteMenuItems("note-1").find(({ id }) => id === "notes.toggleHeader");
  if (!item) throw new Error("Hide header menu item was not registered.");
  return item;
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

describe("note header visibility", () => {
  it("requires showing a hidden header before renaming its title", () => {
    expect(canRenameNoteHeader(true)).toBe(false);
    expect(canRenameNoteHeader(undefined)).toBe(true);
    expect(canRenameNoteHeader(false)).toBe(true);
  });

  it("keeps the hidden header as a move handle while its title is locked", () => {
    headerMenuItem().run("note-1");

    expect(canRenameNoteHeader(board.notes["note-1"]?.headerHidden)).toBe(false);
    expect(notePressIntent("header", "note-1", null)).toBe("move-candidate");
  });

  it("keeps an invisible pointer-active drag strip above the body without covering it", () => {
    expect(noteNodeSource).toContain("data-header-drag-strip");
    expect(noteNodeSource).toMatch(/\.hidden-note-header\s*\{[\s\S]*?bottom:\s*100%;[\s\S]*?opacity:\s*0;[\s\S]*?pointer-events:\s*auto;/);
    expect(notePressIntent("header", "note-1", null)).toBe("move-candidate");
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

  it("hides or shows every eligible selected header uniformly in one Undo step", () => {
    const alreadyHidden = note(17.2, "note-2", true);
    const beacon = { ...note(7.2, "beacon"), type: "beacon" as const };
    const image = { ...note(12, "image"), type: "image" as const };
    replaceBoard([note(), alreadyHidden, beacon, image]);
    selection.ids = ["note-1", "note-2", "beacon", "image"];

    const item = headerMenuItem();
    expect(item.label("note-1")).toBe("Hide header");
    item.run("note-1");

    expect(board.notes["note-1"]).toMatchObject({ headerHidden: true, height: 17.2 });
    expect(board.notes["note-2"]).toMatchObject({ headerHidden: true, height: 17.2 });
    expect(board.notes.beacon?.headerHidden).toBeUndefined();
    expect(board.notes.image?.headerHidden).toBeUndefined();
    expect(history.entries).toHaveLength(1);

    undo();
    expect(board.notes["note-1"]).toMatchObject({ height: 20 });
    expect(board.notes["note-1"]?.headerHidden).toBeUndefined();
    expect(board.notes["note-2"]).toMatchObject({ headerHidden: true, height: 17.2 });
    redo();
    expect(board.notes["note-1"]).toMatchObject({ headerHidden: true, height: 17.2 });

    expect(item.label("note-1")).toBe("Show header");
    item.run("note-1");
    expect(board.notes["note-1"]).toMatchObject({ headerHidden: false, height: 20 });
    expect(board.notes["note-2"]).toMatchObject({ headerHidden: false, height: 20 });
    expect(history.entries).toHaveLength(2);
    undo();
    expect(board.notes["note-1"]).toMatchObject({ headerHidden: true, height: 17.2 });
    expect(board.notes["note-2"]).toMatchObject({ headerHidden: true, height: 17.2 });
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
