import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { board, replaceBoard } from "../src/model/board.svelte";
import { links, replaceLinks } from "../src/model/links.svelte";
import type { Note } from "../src/model/note";
import { clear as clearHistory, history, redo, undo } from "../src/history/history.svelte";
import { clearSelection, includeSelected, selection } from "../src/selection/selection.svelte";
import { deleteSelection } from "../src/clipboard/commands";
import { clearSelectedLink } from "../src/links/selection.svelte";
import { duplicateSelection } from "../src/clipboard/commands";
import { pointer } from "../src/board/camera.svelte";
import { measuredHeights } from "../src/notes/layout.svelte";

const attachedLink = { id: "two-three", from: "two", to: "three", kind: "strong" as const, shape: "base" as const };

const notes: Note[] = [
  { id: "one", type: "note", name: "One", text: "first", x: 1, y: 2, width: 30, height: null },
  { id: "two", type: "note", name: "Two", text: "second", x: 9, y: 12, width: 24, height: 18 },
  { id: "three", type: "note", name: "Three", text: "third", x: -3, y: 6, width: 20, height: 10 },
];

beforeEach(() => {
  clearHistory();
  for (const id of Object.keys(measuredHeights)) delete measuredHeights[id];
  replaceBoard(notes.map((note) => ({ ...note })));
  replaceLinks([{ ...attachedLink }]);
  clearSelectedLink();
  clearSelection();
  includeSelected("two");
  includeSelected("one");
});

afterEach(() => {
  clearHistory();
  clearSelection();
  clearSelectedLink();
  replaceLinks([]);
  replaceBoard([]);
  for (const id of Object.keys(measuredHeights)) delete measuredHeights[id];
  pointer.world = null;
});

describe("clipboard delete history", () => {
  it("deletes a group in one step and restores ids, text, geometry, order, and selection", () => {
    deleteSelection();

    expect(Object.keys(board.notes)).toEqual(["three"]);
    expect(board.order).toEqual(["three"]);
    expect(links.byId[attachedLink.id]).toBeUndefined();
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0]).toMatchObject({ label: "Delete", target: "2 notes" });

    undo();
    expect(board.order).toEqual(["one", "two", "three"]);
    expect(board.notes.one).toEqual(notes[0]);
    expect(board.notes.two).toEqual(notes[1]);
    expect(selection.ids).toEqual(["two", "one"]);
    expect(links.byId[attachedLink.id]).toEqual(attachedLink);

    redo();
    expect(board.order).toEqual(["three"]);
    expect(board.notes.one).toBeUndefined();
    expect(board.notes.two).toBeUndefined();
    expect(links.byId[attachedLink.id]).toBeUndefined();
  });
});

describe("clipboard creation placement", () => {
  it("moves a duplicate away from its source and restores the selection with the same history step", () => {
    clearHistory();
    const original: Note = { id: "source", type: "note", name: "Source", text: "", x: -15, y: -5, width: 30, height: null };
    replaceBoard([original]);
    replaceLinks([]);
    clearSelection();
    clearSelectedLink();
    includeSelected(original.id);
    pointer.world = { x: 0, y: 0 };
    measuredHeights[original.id] = 20;

    duplicateSelection();
    const [copyId] = selection.ids.filter((id) => id !== original.id);
    const copy = board.notes[copyId]!;
    const sourceRight = original.x + original.width;
    const sourceBottom = original.y + measuredHeights[original.id]!;
    const copyHeight = measuredHeights[original.id]!;

    expect(copyId).toBeTruthy();
    expect(copy.x < sourceRight && copy.x + copy.width > original.x &&
      copy.y < sourceBottom && copy.y + copyHeight > original.y).toBe(false);
    expect(selection.ids).toEqual([copyId]);
    expect(history.entries).toHaveLength(1);

    undo();
    expect(selection.ids).toEqual([original.id]);
    expect(board.notes[copyId]).toBeUndefined();
    redo();
    expect(selection.ids).toEqual([copyId]);
    expect(board.notes[copyId]).toBeDefined();
  });
});
