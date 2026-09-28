export interface ShortcutKeyPress {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export interface ShortcutCaptureCallbacks {
  isCapturing(): boolean;
  onShortcut(shortcut: string): void;
  onCancel(): void;
  onUnsupportedKey(): void;
}

/**
 * Listen at the window capture phase so shortcut capture survives pointer focus
 * being cleared from the Settings button by the global focus guard.
 */
export function installQuickInputShortcutCapture(
  target: Pick<EventTarget, "addEventListener" | "removeEventListener">,
  callbacks: ShortcutCaptureCallbacks,
): () => void {
  const handleKeydown = (event: Event): void => {
    if (!callbacks.isCapturing()) return;
    const keyEvent = event as KeyboardEvent;
    if (["Control", "Alt", "Shift", "Meta"].includes(keyEvent.key)) return;

    keyEvent.preventDefault();
    keyEvent.stopPropagation();
    if (keyEvent.key === "Escape") {
      callbacks.onCancel();
      return;
    }

    const shortcut = shortcutFromKeyPress(keyEvent);
    if (!shortcut) {
      callbacks.onUnsupportedKey();
      return;
    }
    callbacks.onShortcut(shortcut);
  };

  target.addEventListener("keydown", handleKeydown, true);
  return () => target.removeEventListener("keydown", handleKeydown, true);
}

/** Convert a captured desktop key chord to the accelerator syntax used by Tauri. */
export function shortcutFromKeyPress(event: ShortcutKeyPress): string | null {
  const key = shortcutKeyName(event.key, event.code);
  if (!key) return null;

  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push("Ctrl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push("Super");
  if (modifiers.length === 0) return null;

  return [...modifiers, key].join("+");
}

function shortcutKeyName(key: string, code: string): string | null {
  if (code === "Space" || key === " ") return "Space";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F(?:[1-9]|1\d|2[0-4])$/.test(key)) return key;
  if (key === "Enter") return "Enter";
  if (key === "Escape") return "Escape";
  return null;
}
