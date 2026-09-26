import { beforeEach, describe, expect, it } from "vitest";
import {
  evaluateExpression,
  formatCalculatorResult,
  recomputeCalculatorEntries,
} from "../src/calculator/expression";
import {
  addCalculatorEntry,
  deleteCalculatorEntry,
  editCalculatorEntry,
} from "../src/calculator/calculatorActions.svelte";
import { clear, history, redo, undo } from "../src/history/history.svelte";
import { replaceCalculators, calculatorData } from "../src/calculator/calculators.svelte";
import type { CalcEntry } from "../src/model/nodeData";

beforeEach(() => {
  clear();
  replaceCalculators({});
});

function value(expression: string): number {
  const result = evaluateExpression(expression);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe("calculator expression evaluator", () => {
  it("uses arithmetic precedence and parentheses", () => {
    expect(value("2 + 3 * 4")).toBe(14);
    expect(value("(2 + 3) * 4")).toBe(20);
  });

  it("supports unary signs and right-associative powers", () => {
    expect(value("-2^2")).toBe(-4);
    expect(value("2^-2")).toBe(0.25);
    expect(value("2^3^2")).toBe(512);
    expect(value("−3 + +5")).toBe(2);
  });

  it("accepts dot and comma decimal separators and percent", () => {
    expect(value("1,5 + 2.25")).toBe(3.75);
    expect(value("12,5%")).toBe(0.125);
    expect(formatCalculatorResult(0.1 + 0.2)).toBe("0.3");
  });

  it("returns a useful error instead of throwing for invalid input", () => {
    for (const expression of ["", "1 / 0", "(2 + 3", "2 +", "alert(1)", "1 2"]) {
      const result = evaluateExpression(expression);
      expect(result.ok, expression).toBe(false);
      if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it("recomputes after an edit and isolates errors to their own row", () => {
    const entries: CalcEntry[] = [
      { id: "one", expression: "1 + 2" },
      { id: "bad", expression: "1 / 0" },
      { id: "three", expression: "(2 + 3) * 4" },
    ];
    const initial = recomputeCalculatorEntries(entries);
    expect(initial.map((entry) => entry.value)).toEqual([3, null, 20]);
    expect(initial[1].error).toContain("zero");

    const edited = recomputeCalculatorEntries(entries.map((entry) =>
      entry.id === "one" ? { ...entry, expression: "10 + 5" } : entry));
    expect(edited.map((entry) => entry.value)).toEqual([15, null, 20]);
  });
});

describe("calculator entry history", () => {
  it("records add, edit, and delete as separate undoable steps", () => {
    const id = addCalculatorEntry("Budget", "1 + 2");
    expect(id).toBeTruthy();
    expect(history.entries).toHaveLength(1);
    expect(addCalculatorEntry("Budget", "  ")).toBeNull();

    expect(editCalculatorEntry("budget", id!, "5 * 3")).toBe(true);
    expect(history.entries).toHaveLength(2);
    expect(calculatorData("BUDGET").entries[0].expression).toBe("5 * 3");

    expect(deleteCalculatorEntry("Budget", id!)).toBe(true);
    expect(history.entries).toHaveLength(3);
    expect(calculatorData("Budget").entries).toEqual([]);

    undo();
    expect(calculatorData("Budget").entries[0].expression).toBe("5 * 3");
    undo();
    expect(calculatorData("Budget").entries[0].expression).toBe("1 + 2");
    undo();
    expect(calculatorData("Budget").entries).toEqual([]);

    redo();
    expect(calculatorData("Budget").entries).toEqual([{ id, expression: "1 + 2" }]);
    redo();
    expect(calculatorData("Budget").entries).toEqual([{ id, expression: "5 * 3" }]);
    redo();
    expect(calculatorData("Budget").entries).toEqual([]);
  });
});
