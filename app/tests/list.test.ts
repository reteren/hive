import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execute, clear, history, redo, undo } from "../src/history/history.svelte";
import { board, replaceBoard, updateNote } from "../src/model/board.svelte";
import type { Note } from "../src/model/note";
import { addListTarget, addListTargetCommand, addListText, removeListRow, reorderListRow } from "../src/list/actions.svelte";
import { listItemDisplay } from "../src/list/logic";

function note(id: string, type: Note["type"] = "note"): Note {
  return { id, type, name: id, text: "", x: 0, y: 0, width: 30, height: null };
}

beforeEach(() => { clear(); replaceBoard([note("list", "list"), note("A"), note("B")]); });
afterEach(() => { clear(); replaceBoard([]); });

describe("List rows", () => {
  it("adds board links and text as separate one-step actions", () => {
    expect(addListTarget("list", "A")).toBe(true);
    expect(addListText("list", "First idea")).toBe(true);
    expect(board.notes.list.listItems).toMatchObject([
      { targetId: "A", label: "A" },
      { targetId: null, label: "First idea" },
    ]);
    expect(history.entries.map((entry) => entry.label)).toEqual(["Add List link", "Add List text"]);
    undo();
    expect(board.notes.list.listItems).toHaveLength(1);
    undo();
    expect(board.notes.list.listItems).toEqual([]);
    redo();
    expect(board.notes.list.listItems).toHaveLength(1);
  });

  it("uses a live target name and leaves a missing row with its saved label", () => {
    addListTarget("list", "A");
    const row = board.notes.list.listItems![0];
    updateNote("A", { name: "Renamed" });
    expect(listItemDisplay(row, board.notes)).toEqual({ label: "Renamed", missing: false });
    delete board.notes.A;
    expect(listItemDisplay(row, board.notes)).toEqual({ label: "A", missing: true });
    expect(removeListRow("list", row.id)).toBe(true);
    expect(board.notes.list.listItems).toEqual([]);
    undo();
    expect(board.notes.list.listItems).toHaveLength(1);
  });

  it("reorders rows by insertion slot without changing their contents, and Undo restores order", () => {
    addListText("list", "one");
    addListText("list", "two");
    addListText("list", "three");
    const rows = board.notes.list.listItems!;
    expect(reorderListRow("list", rows[0].id, 3)).toBe(true);
    expect(board.notes.list.listItems!.map((item) => item.label)).toEqual(["two", "three", "one"]);
    undo();
    expect(board.notes.list.listItems!.map((item) => item.label)).toEqual(["one", "two", "three"]);
    expect(reorderListRow("list", rows[0].id, 1)).toBe(false);
  });

  it("creates one reversible command for a board-node drop, without moving the target", () => {
    const beforeX = board.notes.B.x;
    const command = addListTargetCommand("list", "B", 0);
    expect(command).not.toBeNull();
    execute(command!);
    expect(board.notes.list.listItems?.[0]).toMatchObject({ targetId: "B", label: "B" });
    expect(board.notes.B.x).toBe(beforeX);
    expect(history.entries).toHaveLength(1);
    undo();
    expect(board.notes.list.listItems).toEqual([]);
  });

  it("rejects empty text and self-links without adding history", () => {
    expect(addListText("list", "  ")).toBe(false);
    expect(addListTarget("list", "list")).toBe(false);
    expect(history.entries).toHaveLength(0);
  });
});
