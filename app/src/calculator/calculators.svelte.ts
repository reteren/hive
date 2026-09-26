import { calculatorKey, emptyCalculatorData, type CalculatorData } from "../model/nodeData";

/**
 * R5 contract: shared calculator contents keyed by calculatorKey(name). Every calculator node with
 * that name (H31) reads and edits the same entry. Raw mutations only — user actions go through
 * history commands in the calculator modules.
 */
export const calculators = $state({
  byKey: {} as Record<string, CalculatorData>,
});

export function calculatorData(name: string): CalculatorData {
  return calculators.byKey[calculatorKey(name)] ?? emptyCalculatorData();
}

export function setCalculatorData(name: string, data: CalculatorData): void {
  calculators.byKey[calculatorKey(name)] = data;
}

export function deleteCalculatorData(name: string): void {
  delete calculators.byKey[calculatorKey(name)];
}

export function replaceCalculators(next: Record<string, CalculatorData>): void {
  calculators.byKey = next;
}
