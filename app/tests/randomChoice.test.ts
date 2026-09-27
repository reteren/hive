import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clear, history, redo, undo } from "../src/history/history.svelte";
import { replaceBoard, board } from "../src/model/board.svelte";
import { replaceLinks } from "../src/model/links.svelte";
import type { Note } from "../src/model/note";
import type { ListItem } from "../src/model/nodeData";
import { pickFromList } from "../src/random/actions.svelte";
import { chooseRandomItem, choicesForRandom, currentRandomPick, linkedListForRandom } from "../src/random/logic";
import { parseProjectIndex, serializeProjectIndex } from "../src/project/index";

function note(id: string, type: Note["type"]): Note {
  return { id, type, name: id, text: "", x: 0, y: 0, width: 30, height: null };
}

beforeEach(() => { clear(); replaceBoard([note("list", "list"), note("random", "random"), note("A", "note")]); replaceLinks([]); });
afterEach(() => { clear(); replaceBoard([]); replaceLinks([]); });

describe("Random Choice", () => {
  it("requires a strong List → Random link and explains missing or empty sources without history", () => {
    expect(pickFromList("random", () => 0)).toEqual({ ok: false, reason: "no-list" });
    replaceLinks([{ id: "weak", from: "list", to: "random", kind: "weak", shape: "base" }]);
    expect(pickFromList("random", () => 0)).toEqual({ ok: false, reason: "no-list" });
    replaceLinks([{ id: "backwards", from: "random", to: "list", kind: "strong", shape: "base" }]);
    expect(pickFromList("random", () => 0)).toEqual({ ok: false, reason: "no-list" });
    replaceLinks([{ id: "valid", from: "list", to: "random", kind: "strong", shape: "base" }]);
    expect(linkedListForRandom("random", board.notes, [{ id: "valid", from: "list", to: "random", kind: "strong", shape: "base" }])?.id).toBe("list");
    expect(pickFromList("random", () => 0)).toEqual({ ok: false, reason: "empty" });
    expect(history.entries).toHaveLength(0);
  });

  it("includes text rows but excludes missing targets, and records one Undo step", () => {
    const rows: ListItem[] = [
      { id: "missing", targetId: "gone", label: "gone" },
      { id: "text", targetId: null, label: "Tea" },
      { id: "live", targetId: "A", label: "old name" },
    ];
    board.notes.list.listItems = rows;
    replaceLinks([{ id: "valid", from: "list", to: "random", kind: "strong", shape: "base" }]);
    expect(choicesForRandom(board.notes.list, board.notes).map((row) => row.id)).toEqual(["text", "live"]);
    const result = pickFromList("random", () => 0.99, 123);
    expect(result).toEqual({ ok: true, pick: { listId: "list", itemId: "live", pickedAt: 123 } });
    expect(currentRandomPick(board.notes.random.randomPick, board.notes.list, board.notes)?.label).toBe("A");
    expect(history.entries).toHaveLength(1);
    undo();
    expect(board.notes.random.randomPick).toBeUndefined();
    redo();
    expect(board.notes.random.randomPick?.itemId).toBe("live");
    delete board.notes.A;
    expect(currentRandomPick(board.notes.random.randomPick, board.notes.list, board.notes)).toMatchObject({
      label: "old name", missing: true,
    });
  });

  it("chooses uniformly across eligible items with a seeded RNG", () => {
    const rows: ListItem[] = ["one", "two", "three"].map((label) => ({ id: label, targetId: null, label }));
    let seed = 123456789;
    const rng = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    const counts = new Map(rows.map((row) => [row.id, 0]));
    for (let index = 0; index < 3000; index += 1) {
      const item = chooseRandomItem(rows, rng)!;
      counts.set(item.id, counts.get(item.id)! + 1);
    }
    expect([...counts.values()].every((count) => count > 850 && count < 1150)).toBe(true);
    expect(chooseRandomItem([], rng)).toBeNull();
  });

  it("persists List rows and the last Random pick in board.json", () => {
    board.notes.list.listItems = [{ id: "text", targetId: null, label: "Tea" }];
    board.notes.random.randomPick = { listId: "list", itemId: "text", pickedAt: 456 };
    const parsed = parseProjectIndex(serializeProjectIndex(Object.values(board.notes)));
    expect(parsed.notes.find((item) => item.id === "list")?.listItems).toEqual(board.notes.list.listItems);
    expect(parsed.notes.find((item) => item.id === "random")?.randomPick).toEqual(board.notes.random.randomPick);
  });
});
