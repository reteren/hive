const TEXT_LIKE_INPUT_TYPES = new Set([
  "date",
  "datetime-local",
  "email",
  "month",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "time",
  "url",
  "week",
]);

interface FocusTargetLike {
  tagName?: string;
  nodeName?: string;
  type?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
  parentElement?: FocusTargetLike | null;
  parentNode?: FocusTargetLike | null;
}

/** True when a target or one of its ancestors owns keyboard text editing. */
export function isTextEditingTarget(target: unknown): boolean {
  let current = toFocusTarget(target);

  while (current) {
    const tagName = (current.tagName ?? current.nodeName ?? "").toUpperCase();

    if (tagName === "TEXTAREA" || tagName === "SELECT") return true;
    if (tagName === "INPUT") {
      const type = (current.type ?? "text").toLowerCase();
      if (TEXT_LIKE_INPUT_TYPES.has(type)) return true;
    }
    if (current.isContentEditable === true) return true;

    const editableAttribute = current.getAttribute?.("contenteditable");
    if (editableAttribute !== null && editableAttribute !== undefined) {
      return editableAttribute.toLowerCase() !== "false";
    }

    current = toFocusTarget(current.parentElement ?? current.parentNode);
  }

  return false;
}

function toFocusTarget(value: unknown): FocusTargetLike | null {
  return value !== null && typeof value === "object" ? (value as FocusTargetLike) : null;
}
