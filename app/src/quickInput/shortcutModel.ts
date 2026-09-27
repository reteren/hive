export const DEFAULT_QUICK_INPUT_SHORTCUT = "Ctrl+Alt+Space";

const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Super"] as const;
const ACCEPTED_MODIFIERS = new Set<string>(MODIFIER_ORDER);

export function normalizeQuickInputShortcut(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parts = value.split("+").map((part) => part.trim());
  if (parts.length < 2 || parts.some((part) => part.length === 0)) return null;

  const rawKey = parts.pop();
  if (!rawKey) return null;
  const modifiers = new Set(parts.map(normalizeModifier));
  if ([...modifiers].some((modifier) => !ACCEPTED_MODIFIERS.has(modifier))) return null;
  if (modifiers.size !== parts.length) return null;
  if (!modifiers.has("Ctrl") && !modifiers.has("Alt") && !modifiers.has("Super")) return null;

  const key = normalizeKeyName(rawKey);
  if (!key) return null;
  return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key].join("+");
}

function normalizeModifier(value: string): string {
  const lowered = value.toLowerCase();
  if (lowered === "control" || lowered === "ctrl") return "Ctrl";
  if (lowered === "alt" || lowered === "option") return "Alt";
  if (lowered === "shift") return "Shift";
  if (lowered === "super" || lowered === "meta" || lowered === "win") return "Super";
  return value;
}

function normalizeKeyName(value: string): string | null {
  if (/^[a-z]$/i.test(value)) return value.toUpperCase();
  if (/^\d$/.test(value)) return value;
  if (/^F(?:[1-9]|1\d|2[0-4])$/i.test(value)) return value.toUpperCase();
  const namedKeys: Record<string, string> = {
    space: "Space",
    enter: "Enter",
    escape: "Escape",
  };
  return namedKeys[value.toLowerCase()] ?? null;
}
