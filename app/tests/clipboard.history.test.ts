import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { board, replaceBoard } from "../src/model/board.svelte";
import { links, replaceLinks } from "../src/model/links.svelte";
import type { Note } from "../src/model/note";
import { clear as clearHistory, history, redo, undo } from "../src/history/history.svelte";
import { clearSelection, includeSelected, selection } from "../src/selection/selection.svelte";
import { deleteSelection } from "../src/clipboard/commands";
import { clearSelectedLink } from "../src/links/selection.svelte";

const attachedLink = { id: "two-three", from: "two", to: "three", kind: "strong" as const, shape: "straight" as const };

const notes: Note[] = [
  { id: "one", type: "note", name: "One", text: "first", x: 1, y: 2, width: 30, height: null },
  { id: "two", type: "note", name: "Two", text: "second", x: 9, y: 12, width: 24, height: 18 },
  { id: "three", type: "note", name: "Three", text: "third", x: -3, y: 6, width: 20, height: 10 },
];

beforeEach(() => {
  clearHistory();
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
