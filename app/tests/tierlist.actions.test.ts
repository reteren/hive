import { beforeEach, describe, expect, it } from "vitest";
import type { Note } from "../src/model/note";
import { board, replaceBoard } from "../src/model/board.svelte";
import { clear as clearHistory, execute, history, redo, undo } from "../src/history/history.svelte";
import {
  addNoteTierCard,
  addTierlistRow,
  changeTierlist,
  deleteTierlistCard,
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
    expect(board.notes.tierlist.tiers).toHaveLength(7);
    undo();
    expect(board.notes.tierlist.tiers).toHaveLength(6);
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
});
