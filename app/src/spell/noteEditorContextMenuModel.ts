import type { SpellcheckContext } from "./spellcheck";
import { t } from "../i18n/i18n.svelte";

export type NoteMenuItem = {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  payload?: string;
  spellSuggestion?: boolean;
};

export type NoteMenuSeparator = { separator: true };
export type NoteMenuOption = NoteMenuItem | NoteMenuSeparator;
export type NoteMenuSubmenu = { kind: "submenu"; label: string; items: NoteMenuOption[] };
export type NoteMenuEntry = NoteMenuOption | NoteMenuSubmenu;

export type NoteMenuOptions = {
  hasSelection: boolean;
  spellContext?: SpellcheckContext | null;
  suggestions?: readonly string[];
  loading?: boolean;
  linkUrl?: string | null;
};

const separator = (): NoteMenuSeparator => ({ separator: true });
const item = (id: string, label: string, shortcut?: string, disabled = false): NoteMenuItem => ({
  id,
  label,
  ...(shortcut ? { shortcut } : {}),
  ...(disabled ? { disabled: true } : {}),
});

export function buildNoteEditorContextMenu(options: NoteMenuOptions): NoteMenuEntry[] {
  const spellItems: NoteMenuOption[] = [];
  if (options.spellContext) {
    const suggestions = options.suggestions ?? [];
    if (suggestions.length) {
      spellItems.push(...suggestions.slice(0, 3).map((suggestion) => ({
        ...item("spellcheck.replace", suggestion),
        payload: JSON.stringify({ ...options.spellContext, suggestion }),
        spellSuggestion: true,
      })));
    } else {
      spellItems.push(item("spellcheck.noSuggestions", options.loading ? t("Checking…") : t("No suggestions"), undefined, true));
    }
    spellItems.push(item("spellcheck.addToDictionary", t("Add to dictionary"), undefined, false));
    spellItems.push(separator());
  }

  const linkItems: NoteMenuOption[] = options.linkUrl
    ? [item("link.open", t("Open link")), item("link.copy", t("Copy link address")), separator()]
    : [];

  return [
    ...spellItems,
    ...linkItems,
    {
      kind: "submenu",
      label: t("Formatting"),
      items: [
        item("format.bold", t("Bold"), "Ctrl+B"),
        item("format.italic", t("Italic"), "Ctrl+I"),
        item("format.strikethrough", t("Strikethrough")),
        item("format.highlight", t("Highlight")),
        separator(),
        item("format.code", t("Inline Code"), "Ctrl+E"),
        item("format.link", t("Link"), "Ctrl+K"),
        separator(),
        item("format.clearFormatting", t("Clear Formatting")),
      ],
    },
    {
      kind: "submenu",
      label: t("Paragraph"),
      items: [
        item("format.list", t("Bullet List")),
        item("format.orderedList", t("Numbered List")),
        item("format.taskList", t("Task List")),
        separator(),
        ...Array.from({ length: 6 }, (_, index) => {
          const level = index + 1;
          return item(`format.heading${level}`, t("Heading {level}", { level }), `Ctrl+${level}`);
        }),
        separator(),
        item("format.clearHeading", t("Remove Heading"), "Ctrl+0"),
      ],
    },
    {
      kind: "submenu",
      label: t("Insert"),
      items: [
        item("format.table", t("Table")),
        item("format.callout", t("Callout")),
        item("format.codeBlock", t("Code Block"), "Ctrl+Shift+K"),
        item("format.mathBlock", t("Math Block")),
        item("format.horizontalRule", t("Horizontal Rule")),
      ],
    },
    separator(),
    item("cut", t("Cut"), "Ctrl+X", !options.hasSelection),
    item("copy", t("Copy"), "Ctrl+C", !options.hasSelection),
    item("paste", t("Paste"), "Ctrl+V"),
    item("edit.pastePlainText", t("Paste as Plain Text"), "Ctrl+Shift+V"),
    item("delete", t("Delete"), undefined, !options.hasSelection),
    item("select-all", t("Select All"), "Ctrl+A"),
  ];
}
