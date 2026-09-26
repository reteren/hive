import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { calculatorData, calculators, replaceCalculators, setCalculatorData } from "../src/calculator/calculators.svelte";
import { clear as clearHistory, history, redo, undo } from "../src/history/history.svelte";
import { board, replaceBoard } from "../src/model/board.svelte";
import type { Note } from "../src/model/note";
import { renameCalculatorNode } from "../src/notes/calculatorRename.svelte";

const data = {
  entries: [{ id: "entry-1", expression: "4 * 5" }],
  bank: { name: "Travel", initial: 100 },
  rows: [{ id: "row-1", label: "Train", amount: 25, sourceNoteId: "source" }],
};

function calculator(id: string, name: string): Note {
  return { id, type: "calculator", name, text: "", x: 0, y: 0, width: 40, height: null };
}

beforeEach(() => {
  clearHistory();
  replaceBoard([]);
  replaceCalculators({});
});

afterEach(() => {
  clearHistory();
  replaceBoard([]);
  replaceCalculators({});
});

describe("calculator mirrors and rename", () => {
  it("shares one case-insensitive entry between same-name mirrors", () => {
    replaceBoard([calculator("first", "Trip"), calculator("second", "trip")]);
    setCalculatorData("TRIP", data);

    expect(calculatorData("Trip")).toEqual(data);
    expect(calculatorData("trip")).toBe(calculatorData("TRIP"));
    expect(Object.keys(calculators.byKey)).toEqual(["trip"]);
  });

  it("moves the last mirror's data on rename and restores name and data on undo/redo", () => {
    replaceBoard([calculator("first", "Before")]);
    setCalculatorData("Before", data);

    expect(renameCalculatorNode("first", "After")).toEqual({ ok: true, name: "After", changed: true });
    expect(history.entries).toHaveLength(1);
    expect(calculatorData("Before")).toEqual({ entries: [], bank: null, rows: [] });
    expect(calculatorData("After")).toEqual(data);

    undo();
    expect(boardNoteName("first")).toBe("Before");
    expect(calculatorData("Before")).toEqual(data);
    expect(calculatorData("After")).toEqual({ entries: [], bank: null, rows: [] });

    redo();
    expect(boardNoteName("first")).toBe("After");
    expect(calculatorData("After")).toEqual(data);
  });

  it("copies data when another mirror remains under the old name", () => {
    replaceBoard([calculator("first", "Before"), calculator("second", "before")]);
    setCalculatorData("Before", data);

    expect(renameCalculatorNode("first", "After")).toMatchObject({ ok: true });
    expect(calculatorData("Before")).toEqual(data);
    expect(calculatorData("After")).toEqual(data);

    undo();
    expect(boardNoteName("first")).toBe("Before");
    expect(calculatorData("Before")).toEqual(data);
    expect(calculatorData("After")).toEqual({ entries: [], bank: null, rows: [] });
  });

  it("refuses to merge two non-empty histories without changing state", () => {
    replaceBoard([calculator("first", "Before"), calculator("second", "After")]);
    setCalculatorData("Before", data);
    const targetData = { entries: [{ id: "target-entry", expression: "99" }], bank: null, rows: [] };
    setCalculatorData("After", targetData);

    expect(renameCalculatorNode("first", "After")).toEqual({
      ok: false,
      message: "A calculator named After already has its own history; rename cancelled.",
    });
    expect(boardNoteName("first")).toBe("Before");
    expect(calculatorData("Before")).toEqual(data);
    expect(calculatorData("After")).toEqual(targetData);
    expect(history.entries).toHaveLength(0);
  });

  it("keeps calculator names away from non-calculator nodes", () => {
    replaceBoard([
      calculator("first", "Before"),
      { id: "note", type: "note", name: "Occupied", text: "", x: 0, y: 0, width: 20, height: null },
    ]);

    expect(renameCalculatorNode("first", "occupied")).toMatchObject({ ok: false });
    expect(boardNoteName("first")).toBe("Before");
    expect(history.entries).toHaveLength(0);
  });
});

function boardNoteName(id: string): string | undefined {
  return board.notes[id]?.name;
}
