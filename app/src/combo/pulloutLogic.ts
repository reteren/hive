export interface PulloutTargetTraits {
  tagName: string;
  role?: string | null;
  contentEditable?: boolean;
  textLink?: boolean;
}

const EXCLUDED_TAGS = new Set(["button", "input", "textarea", "select", "label", "a"]);
const EXCLUDED_ROLES = new Set([
  "button", "checkbox", "combobox", "link", "menuitem", "menuitemcheckbox",
  "menuitemradio", "option", "radio", "switch", "tab",
]);

/** Embedded-section background starts an extraction drag; interactive controls keep their normal input. */
export function canStartComboPulloutFrom(target: PulloutTargetTraits): boolean {
  const tagName = target.tagName.toLowerCase();
  const role = target.role?.toLowerCase();
  return !EXCLUDED_TAGS.has(tagName) &&
    (role === undefined || role === null || !EXCLUDED_ROLES.has(role)) &&
    !target.contentEditable && !target.textLink;
}
