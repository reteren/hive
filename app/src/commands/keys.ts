/** Parsed form of the compact key notation used by registered commands. */
export interface KeyBinding {
  code: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

const MODIFIERS = ["Ctrl", "Shift", "Alt"] as const;

/** Parse `Ctrl+Shift+KeyA` notation, rejecting unknown or out-of-order modifiers. */
export function parseKey(notation: string): KeyBinding {
  const parts = notation.split("+");
  const code = parts.pop();
  if (!code || code.trim() !== code || parts.some((part) => part.trim() !== part)) {
    throw new Error(`Invalid key binding: ${notation}`);
  }

  const modifiers = parts as string[];
  const modifierIndexes = modifiers.map((modifier) => MODIFIERS.indexOf(modifier as (typeof MODIFIERS)[number]));
  if (
    modifiers.length > MODIFIERS.length ||
    modifierIndexes.some((index) => index < 0) ||
    modifierIndexes.some((index, position) => position > 0 && index <= modifierIndexes[position - 1])
  ) {
    throw new Error(`Invalid key binding: ${notation}`);
  }

  return {
    code,
    ctrl: modifiers.includes("Ctrl"),
    shift: modifiers.includes("Shift"),
    alt: modifiers.includes("Alt"),
  };
}

const DISPLAY_CODES: Record<string, string> = {
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  Backspace: "Backspace",
  BracketLeft: "[",
  BracketRight: "]",
  Delete: "Delete",
  Enter: "Enter",
  Escape: "Esc",
  Equal: "=",
  Minus: "-",
  NumpadAdd: "Num +",
  NumpadSubtract: "Num -",
  PageDown: "Page Down",
  PageUp: "Page Up",
  Space: "Space",
  Tab: "Tab",
};

/** Format a notation string or parsed binding for a compact UI label. */
export function formatKey(binding: string | KeyBinding): string {
  const parsed = typeof binding === "string" ? parseKey(binding) : binding;
  const modifiers = [
    ...(parsed.ctrl ? ["Ctrl"] : []),
    ...(parsed.shift ? ["Shift"] : []),
    ...(parsed.alt ? ["Alt"] : []),
  ];
  const codeLabel =
    DISPLAY_CODES[parsed.code] ??
    (/^Key[A-Z]$/.test(parsed.code) ? parsed.code.slice(3) : undefined) ??
    (/^Digit\d$/.test(parsed.code) ? parsed.code.slice(5) : undefined) ??
    parsed.code;

  return [...modifiers, codeLabel].join("+");
}

/** Compare against KeyboardEvent.code and the complete Ctrl/Shift/Alt modifier set. */
export function matchesKey(event: KeyboardEvent, binding: string | KeyBinding): boolean {
  const parsed = typeof binding === "string" ? parseKey(binding) : binding;
  return (
    event.code === parsed.code &&
    event.ctrlKey === parsed.ctrl &&
    event.shiftKey === parsed.shift &&
    event.altKey === parsed.alt &&
    !event.metaKey
  );
}
