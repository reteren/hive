export type SelectKeyboardAction = "open" | "down" | "up" | "select" | "close" | null;

export function selectKeyboardAction(key: string, isOpen: boolean): SelectKeyboardAction {
  if (!isOpen) return key === "ArrowDown" || key === "ArrowUp" ? "open" : null;
  if (key === "ArrowDown") return "down";
  if (key === "ArrowUp") return "up";
  if (key === "Enter") return "select";
  if (key === "Escape") return "close";
  return null;
}

export function moveSelectIndex(current: number, delta: -1 | 1, optionCount: number): number {
  if (optionCount <= 0) return -1;
  return (current + delta + optionCount) % optionCount;
}
