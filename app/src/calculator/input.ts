import { isTextEditingTarget } from "../commands/focus";

export type CalculatorInputKey = "enter" | "escape" | "other";

/** Classify calculator keystrokes only when a text-editing control owns focus. */
export function calculatorInputKey(
  event: Pick<KeyboardEvent, "key" | "target">,
): CalculatorInputKey | null {
  if (!isTextEditingTarget(event.target)) return null;
  if (event.key === "Enter") return "enter";
  if (event.key === "Escape") return "escape";
  return "other";
}
