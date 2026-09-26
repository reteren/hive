import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bankTotals, parseBankAmount } from "../src/calculator/bank";
import {
  addManualBankRow,
  bankFocus,
  commitBankRowAmount,
  commitBankInitial,
  commitBankName,
  createBank,
  deleteBankRow,
  previewBankRowAmount,
  previewBankInitial,
  previewBankName,
  removeBank,
  syncBankRowLabels,
} from "../src/calculator/bankActions.svelte";
import { calculatorData, replaceCalculators } from "../src/calculator/calculators.svelte";
import { clear, execute, history, redo, undo } from "../src/history/history.svelte";
import { createBoardLink, cutLinks, unlink } from "../src/links/operations";
import { linkRefusalReason } from "../src/links/rules";
import { addNote, removeNote, replaceBoard, updateNote } from "../src/model/board.svelte";
import type { Link } from "../src/model/link";
import { addLink, removeLink, replaceLinks } from "../src/model/links.svelte";
import type { Note } from "../src/model/note";
import { clearSelection, includeSelected } from "../src/selection/selection.svelte";
import { duplicateSelection } from "../src/clipboard/commands";
import { pointer } from "../src/board/camera.svelte";

function note(id: string, type: Note["type"] = "note"): Note {
  return { id, type, name: id, text: "", x: 0, y: 0, width: 20, height: null };
}

function link(id: string, kind: Link["kind"] = "strong"): Link {
  return { id, from: "source", to: "calculator", kind, shape: "base" };
}

beforeEach(() => {
  clear();
  replaceBoard([]);
  replaceLinks([]);
  replaceCalculators({});
  clearSelection();
  addNote(note("source"));
  addNote(note("calculator", "calculator"));
});

afterEach(() => {
  clear();
  replaceBoard([]);
  replaceLinks([]);
  replaceCalculators({});
  clearSelection();
  pointer.world = null;
});

describe("calculator bank", () => {
  it("edits the bank name and initial sum with live totals and one Undo each", () => {
    createBank("calculator", "Trip", 100);
    previewBankName("calculator", "Holiday");
    commitBankName("calculator", "Trip", "Holiday");
    previewBankInitial("calculator", 120);
    commitBankInitial("calculator", 100, 120);
    expect(calculatorData("calculator").bank).toEqual({ name: "Holiday", initial: 120 });
    expect(history.entries).toHaveLength(3);
    undo();
    expect(bankTotals(calculatorData("calculator"))?.initial).toBe(100);
    undo();
    expect(calculatorData("calculator").bank?.name).toBe("Trip");
    expect(parseBankAmount("0x10")).toBeNull();
    expect(parseBankAmount("-2.5")).toBe(-2.5);
  });

  it("shares a bank between calculator names that differ only by case", () => {
    createBank("calculator", "Trip", 100);
    const rowId = addManualBankRow("CALCULATOR", "Book", 20);
    expect(rowId).not.toBeNull();
    expect(bankTotals(calculatorData("calculator"))?.remaining).toBe(80);
    expect(calculatorData("CALCULATOR").rows).toHaveLength(1);
  });

  it("keeps one row when the same source links to two mirrored calculators", () => {
    addNote({ ...note("mirror", "calculator"), name: "CALCULATOR" });
    createBank("calculator", "Trip", 100);
    createBoardLink(link("bank-mirror-a"));
    createBoardLink({ ...link("bank-mirror-b"), to: "mirror" });
    expect(calculatorData("calculator").rows).toHaveLength(1);
    unlink("bank-mirror-a");
    expect(calculatorData("calculator").rows[0].sourceNoteId).toBe("source");
    unlink("bank-mirror-b");
    expect(calculatorData("calculator").rows[0].sourceNoteId).toBeNull();
    undo();
    expect(calculatorData("calculator").rows).toHaveLength(1);
    expect(calculatorData("calculator").rows[0].sourceNoteId).toBe("source");
  });

  it("recomputes 100 − 20 = 80 and 100 − 30 = 70 in one Undo step for the amount edit", () => {
    expect(createBank("calculator", "Trip", 100)).toBe(true);
    const rowId = addManualBankRow("calculator", "Book", 20);
    expect(rowId).not.toBeNull();
    expect(bankTotals(calculatorData("calculator"))?.remaining).toBe(80);

    previewBankRowAmount("calculator", rowId!, 30);
    expect(bankTotals(calculatorData("calculator"))?.remaining).toBe(70);
    commitBankRowAmount("calculator", rowId!, 20, 30);
    expect(history.entries).toHaveLength(3);
    undo();
    expect(bankTotals(calculatorData("calculator"))?.remaining).toBe(80);
    redo();
    expect(bankTotals(calculatorData("calculator"))?.remaining).toBe(70);
    removeBank("calculator");
    expect(calculatorData("calculator").rows).toEqual([]);
    undo();
    expect(bankTotals(calculatorData("calculator"))?.remaining).toBe(70);
  });

  it("creates one linked row in the link history step and never duplicates it on redo", () => {
    createBank("calculator", "Trip", 100);
    expect(createBoardLink(link("bank-link-1"))).toBe(true);
    expect(calculatorData("calculator").rows).toEqual([{
      id: "bank-link:bank-link-1", label: "source", amount: 0, sourceNoteId: "source",
    }]);
    expect(bankFocus).toMatchObject({ calculatorId: "calculator", rowId: "bank-link:bank-link-1" });
    expect(history.entries).toHaveLength(2);
    undo();
    expect(calculatorData("calculator").rows).toEqual([]);
    redo();
    expect(calculatorData("calculator").rows).toHaveLength(1);
    undo();
    redo();
    expect(calculatorData("calculator").rows).toHaveLength(1);
  });

  it("keeps the last name and amount when the source note is deleted, then restores the same row", () => {
    createBank("calculator", "Trip", 100);
    createBoardLink(link("bank-link-2"));
    previewBankRowAmount("calculator", "bank-link:bank-link-2", 20);
    commitBankRowAmount("calculator", "bank-link:bank-link-2", 0, 20);
    updateNote("source", { name: "Book" });
    syncBankRowLabels();
    expect(calculatorData("calculator").rows[0].label).toBe("Book");

    const source = note("source");
    execute({
      label: "Delete source",
      do: () => { removeLink("bank-link-2"); removeNote("source"); },
      undo: () => { addNote({ ...source, name: "Book" }); addLink(link("bank-link-2")); },
    });
    expect(calculatorData("calculator").rows).toEqual([{
      id: "bank-link:bank-link-2", label: "Book", amount: 20, sourceNoteId: "source",
    }]);
    expect(bankTotals(calculatorData("calculator"))?.remaining).toBe(80);
    undo();
    expect(calculatorData("calculator").rows).toHaveLength(1);
    expect(calculatorData("calculator").rows[0].amount).toBe(20);
  });

  it("detaches on explicit unlink, preserving the amount; Undo reconnects the existing row", () => {
    createBank("calculator", "Trip", 100);
    createBoardLink(link("bank-link-3"));
    previewBankRowAmount("calculator", "bank-link:bank-link-3", 25);
    commitBankRowAmount("calculator", "bank-link:bank-link-3", 0, 25);
    expect(unlink("bank-link-3")).toBe(true);
    expect(calculatorData("calculator").rows).toEqual([{
      id: "bank-link:bank-link-3", label: "source", amount: 25, sourceNoteId: null,
    }]);
    undo();
    expect(calculatorData("calculator").rows).toHaveLength(1);
    expect(calculatorData("calculator").rows[0].sourceNoteId).toBe("source");
    expect(calculatorData("calculator").rows[0].amount).toBe(25);
  });

  it("detaches a cut line without deleting its bank row", () => {
    createBank("calculator", "Trip", 100);
    createBoardLink(link("bank-link-cut"));
    expect(cutLinks(["bank-link-cut"])).toBe(true);
    expect(calculatorData("calculator").rows[0].sourceNoteId).toBeNull();
    undo();
    expect(calculatorData("calculator").rows).toHaveLength(1);
    expect(calculatorData("calculator").rows[0].sourceNoteId).toBe("source");
  });

  it("does not recreate a deliberately deleted row when a source deletion is undone", () => {
    createBank("calculator", "Trip", 100);
    createBoardLink(link("bank-link-4"));
    expect(deleteBankRow("calculator", "bank-link:bank-link-4")).toBe(true);
    expect(calculatorData("calculator").rows).toEqual([]);
    const source = note("source");
    execute({
      label: "Delete source",
      do: () => { removeLink("bank-link-4"); removeNote("source"); },
      undo: () => { addNote(source); addLink(link("bank-link-4")); },
    });
    undo();
    expect(calculatorData("calculator").rows).toEqual([]);
    undo();
    expect(calculatorData("calculator").rows).toHaveLength(1);
  });

  it("only strong non-beacon sources create rows", () => {
    createBank("calculator", "Trip", 100);
    expect(createBoardLink(link("weak-link", "weak"))).toBe(true);
    expect(calculatorData("calculator").rows).toEqual([]);
    expect(linkRefusalReason("me", "calculator", "strong", [])).toMatch(/Beacon/i);
    expect(linkRefusalReason("module", "calculator", "strong", [], {
      source: note("source"), calculator: note("calculator", "calculator"),
      module: note("module", "importance"),
    })).toBeNull();
  });

  it("removes a copied linked row in the same Undo step as Duplicate", () => {
    createBank("calculator", "Trip", 100);
    createBoardLink(link("original-link"));
    clearSelection();
    includeSelected("source");
    includeSelected("calculator");
    pointer.world = { x: 100, y: 100 };

    duplicateSelection();
    expect(calculatorData("calculator").rows).toHaveLength(2);
    undo();
    expect(calculatorData("calculator").rows).toHaveLength(1);
    redo();
    expect(calculatorData("calculator").rows).toHaveLength(2);
  });
});
