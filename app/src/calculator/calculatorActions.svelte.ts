import { execute } from "../history/history.svelte";
import { newId } from "../model/note";
import type { CalcEntry, CalculatorData } from "../model/nodeData";
import { calculatorData, setCalculatorData } from "./calculators.svelte";

function copyData(data: CalculatorData): CalculatorData {
  return {
    entries: data.entries.map((entry) => ({ ...entry })),
    bank: data.bank ? { ...data.bank } : null,
    rows: data.rows.map((row) => ({ ...row })),
  };
}

function commitEntries(name: string, label: string, entries: CalcEntry[]): void {
  const before = copyData(calculatorData(name));
  const after = copyData({ ...before, entries });
  execute({
    label,
    target: name,
    do: () => setCalculatorData(name, copyData(after)),
    undo: () => setCalculatorData(name, copyData(before)),
  });
}

/** Add one permanent expression to this calculator and all same-name mirrors. */
export function addCalculatorEntry(name: string, expression: string): string | null {
  if (!expression.trim()) return null;
  const entry: CalcEntry = { id: newId(), expression };
  commitEntries(name, "Add calculator entry", [...calculatorData(name).entries, entry]);
  return entry.id;
}

/** Save one expression edit as a single Undo step. Invalid expressions remain editable history rows. */
export function editCalculatorEntry(name: string, id: string, expression: string): boolean {
  const entries = calculatorData(name).entries;
  const previous = entries.find((entry) => entry.id === id);
  if (!previous || previous.expression === expression) return false;
  commitEntries(name, "Edit calculator entry", entries.map((entry) => entry.id === id ? { ...entry, expression } : entry));
  return true;
}

/** Delete one saved expression as a single Undo step. */
export function deleteCalculatorEntry(name: string, id: string): boolean {
  const entries = calculatorData(name).entries;
  if (!entries.some((entry) => entry.id === id)) return false;
  commitEntries(name, "Delete calculator entry", entries.filter((entry) => entry.id !== id));
  return true;
}
