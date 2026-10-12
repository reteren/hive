import { calculatorKey, emptyCalculatorData, type CalculatorData } from "../model/nodeData";
import { markProjectChanged } from "../project/changeSignal.svelte";

/**
 * R5 contract: shared calculator contents keyed by calculatorKey(name). Every calculator node with
 * that name (H31) reads and edits the same entry. Raw mutations only — user actions go through
 * history commands in the calculator modules.
 */
export const calculators = $state({
  byKey: Object.create(null) as Record<string, CalculatorData>,
});

let changeRevision = 0;
const mutationListeners = new Set<(revision: number) => void>();

export function calculatorsRevision(): number {
  return changeRevision;
}

export function onCalculatorsMutation(listener: (revision: number) => void): () => void {
  mutationListeners.add(listener);
  return () => mutationListeners.delete(listener);
}

export function calculatorData(name: string): CalculatorData {
  const key = calculatorKey(name);
  return Object.prototype.hasOwnProperty.call(calculators.byKey, key)
    ? calculators.byKey[key]
    : emptyCalculatorData();
}

export function setCalculatorData(name: string, data: CalculatorData): void {
  const next = Object.assign(Object.create(null) as Record<string, CalculatorData>, calculators.byKey);
  next[calculatorKey(name)] = data;
  calculators.byKey = next;
  notifyChanged();
}

export function deleteCalculatorData(name: string): void {
  const next = Object.assign(Object.create(null) as Record<string, CalculatorData>, calculators.byKey);
  delete next[calculatorKey(name)];
  calculators.byKey = next;
  notifyChanged();
}

export function replaceCalculators(next: Record<string, CalculatorData>): void {
  calculators.byKey = Object.assign(Object.create(null) as Record<string, CalculatorData>, next);
  notifyChanged();
}

function notifyChanged(): void {
  changeRevision += 1;
  markProjectChanged();
  for (const listener of mutationListeners) listener(changeRevision);
}
