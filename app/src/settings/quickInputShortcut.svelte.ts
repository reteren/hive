import { DEFAULT_QUICK_INPUT_SHORTCUT } from "../quickInput/shortcutModel";

export const quickInputShortcut = $state({
  value: DEFAULT_QUICK_INPUT_SHORTCUT,
  error: "",
  capturing: false,
});

export function setQuickInputShortcutValue(value: string): void {
  quickInputShortcut.value = value;
}

export function setQuickInputShortcutError(error: string): void {
  quickInputShortcut.error = error;
}
