import { beforeEach, describe, expect, it } from "vitest";
import type { Note } from "../src/model/note";
import { board, replaceBoard } from "../src/model/board.svelte";
import { clear as clearHistory, execute, history, redo, undo } from "../src/history/history.svelte";
import {
  addNoteTierCard,
  addTierlistRow,
  changeTierlist,
  createTierlistTextCardNoteCommand,
  deleteTierlistCard,
  duplicateTierlistCard,
  rowsForTierlist,
} from "../src/tierlist/actions.svelte";
import { createDefaultTierRows } from "../src/tierlist/logic";

function defaultRows() {
  let id = 0;
  return createDefaultTierRows(() => `row-${id++}`);
}

const tierlist: Note = {
  id: "tierlist", type: "tierlist", name: "Ranking", text: "", x: 10, y: 20, width: 60, height: null,
  tiers: defaultRows(),
};
const source: Note = {
  id: "source", type: "note", name: "Source", text: "Original content", x: 90, y: 20, width: 30, height: null,
};

describe("Tierlist history actions", () => {
  beforeEach(() => {
    replaceBoard([{ ...tierlist, tiers: defaultRows() }, { ...source }]);
    clearHistory();
  });

  it("records one reversible command for an edit", () => {
    const changed = [...rowsForTierlist("tierlist")];
    changed[0] = { ...changed[0], name: "Top" };
    expect(changeTierlist("tierlist", "Rename tier row", changed)).toBe(true);
    expect(history.entries.map(({ label }) => label)).toEqual(["Rename tier row"]);
    expect(board.notes.tierlist.tiers?.[0].name).toBe("Top");

    undo();
    expect(board.notes.tierlist.tiers?.[0].name).toBe("S");
    redo();
    expect(board.notes.tierlist.tiers?.[0].name).toBe("Top");
  });

  it("undoes a row add as one step", () => {
    addTierlistRow("tierlist");
    expect(history.entries).toHaveLength(1);
    expect(board.notes.tierlist.tiers).toHaveLength(8);
    undo();
    expect(board.notes.tierlist.tiers).toHaveLength(7);
  });

  it("adds and removes a live preview card without moving or deleting its source", () => {
    const rowId = rowsForTierlist("tierlist")[0].id;
    const command = addNoteTierCard("tierlist", rowId, "source");
    expect(command).not.toBeNull();
    if (!command) return;
    // Board drop commands are executed by SelectionLayer after it restores the node's position.
    execute(command);
    expect(board.notes.source).toMatchObject({ name: "Source", text: "Original content", x: 90 });
    expect(board.notes.tierlist.tiers?.[0].cards).toEqual([{ id: expect.any(String), kind: "note", noteId: "source" }]);
    expect(history.entries).toHaveLength(1);

    undo();
    expect(board.notes.tierlist.tiers?.[0].cards).toEqual([]);
    expect(board.notes.source).toBeDefined();
  });

  it("deleting the card never removes its source note", () => {
    const rowId = rowsForTierlist("tierlist")[0].id;
    const command = addNoteTierCard("tierlist", rowId, "source");
    if (command) {
      execute(command);
    }
    const cardId = board.notes.tierlist.tiers?.[0].cards[0]?.id;
    expect(cardId).toBeTruthy();
    if (cardId) deleteTierlistCard("tierlist", rowId, cardId);
    expect(board.notes.source).toBeDefined();
    expect(board.notes.tierlist.tiers?.[0].cards).toEqual([]);
  });

  it("turns a dragged text card into a named board note in one undo step", () => {
    const rowId = rowsForTierlist("tierlist")[0].id;
    const rows = rowsForTierlist("tierlist");
    rows[0].cards.push({ id: "dragged", kind: "text", text: "Keep this text" });
    changeTierlist("tierlist", "Prepare text card", rows);
    clearHistory();

    const command = createTierlistTextCardNoteCommand("tierlist", rowId, "dragged", { x: 200, y: 80 });
    expect(command).not.toBeNull();
    if (!command) return;
    execute(command);

    const created = Object.values(board.notes).find((item) => item.name === "Tierlist note #1");
    expect(created).toBeDefined();
    if (!created) return;
    expect(created).toMatchObject({ type: "note", text: "Keep this text", width: 30 });
    expect(created?.x).toBe(185);
    expect(created.x + created.width / 2).toBe(200);
    expect(rowsForTierlist("tierlist")[0].cards).toEqual([]);
    expect(history.entries).toHaveLength(1);

    undo();
    expect(created.id in board.notes).toBe(false);
    expect(rowsForTierlist("tierlist")[0].cards).toEqual([{ id: "dragged", kind: "text", text: "Keep this text" }]);
  });

  it("does not turn a live node preview card into a board note", () => {
    const rowId = rowsForTierlist("tierlist")[0].id;
    const rows = rowsForTierlist("tierlist");
    rows[0].cards.push({ id: "preview", kind: "note", noteId: "source" });
    changeTierlist("tierlist", "Prepare node preview", rows);
    clearHistory();

    expect(createTierlistTextCardNoteCommand("tierlist", rowId, "preview", { x: 200, y: 80 })).toBeNull();
    expect(rowsForTierlist("tierlist")[0].cards).toEqual([{ id: "preview", kind: "note", noteId: "source" }]);
    expect(board.notes.source).toBeDefined();
    expect(history.entries).toHaveLength(0);
  });

  it("duplicates text cards into another Tierlist with one undo step", () => {
    const sourceRows = defaultRows().map((row, index) => ({ ...row, id: `source-row-${index}` }));
    sourceRows[0].cards.push({ id: "text-card", kind: "text", text: "Copied text" });
    const targetRows = defaultRows().map((row, index) => ({ ...row, id: `target-row-${index}` }));
    const target: Note = { ...tierlist, id: "target-tierlist", name: "Archive", tiers: targetRows };
    replaceBoard([{ ...tierlist, tiers: sourceRows }, target, { ...source }]);
    clearHistory();

    expect(duplicateTierlistCard("tierlist", "source-row-0", "text-card", "target-tierlist", "target-row-0", 0)).toBe(true);
    const copy = board.notes["target-tierlist"].tiers?.[0].cards[0];
    expect(copy).toMatchObject({ kind: "text", text: "Copied text" });
    expect(copy?.id).not.toBe("text-card");
    expect(rowsForTierlist("tierlist")[0].cards).toEqual([{ id: "text-card", kind: "text", text: "Copied text" }]);
    expect(history.entries).toHaveLength(1);

    undo();
    expect(rowsForTierlist("target-tierlist")[0].cards).toEqual([]);
    expect(rowsForTierlist("tierlist")[0].cards).toEqual([{ id: "text-card", kind: "text", text: "Copied text" }]);
  });

  it("duplicates node previews while keeping their original note reference and supports undo", () => {
    const sourceRows = defaultRows().map((row, index) => ({ ...row, id: `source-row-${index}` }));
    sourceRows[0].cards.push({ id: "preview-card", kind: "note", noteId: "source" });
    const targetRows = defaultRows().map((row, index) => ({ ...row, id: `target-row-${index}` }));
    const target: Note = { ...tierlist, id: "target-tierlist", name: "Archive", tiers: targetRows };
    replaceBoard([{ ...tierlist, tiers: sourceRows }, target, { ...source }]);
    clearHistory();

    expect(duplicateTierlistCard("tierlist", "source-row-0", "preview-card", "target-tierlist", "target-row-1", 0)).toBe(true);
    const copy = board.notes["target-tierlist"].tiers?.[1].cards[0];
    expect(copy).toMatchObject({ kind: "note", noteId: "source" });
    expect(copy?.id).not.toBe("preview-card");
    expect(board.notes.source).toMatchObject({ name: "Source", text: "Original content" });
    expect(history.entries).toHaveLength(1);

    undo();
    expect(rowsForTierlist("target-tierlist")[1].cards).toEqual([]);
    expect(rowsForTierlist("tierlist")[0].cards).toEqual([{ id: "preview-card", kind: "note", noteId: "source" }]);
  });
});
