import type { SpellcheckContext } from "./spellcheck";

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
      spellItems.push(item("spellcheck.noSuggestions", options.loading ? "Checking…" : "No suggestions", undefined, true));
    }
    spellItems.push(item("spellcheck.addToDictionary", "Add to dictionary", undefined, false));
    spellItems.push(separator());
  }

  const linkItems: NoteMenuOption[] = options.linkUrl
    ? [item("link.open", "Open link"), item("link.copy", "Copy link address"), separator()]
    : [];

  return [
    ...spellItems,
    ...linkItems,
    {
      kind: "submenu",
      label: "Formatting",
      items: [
        item("format.bold", "Bold", "Ctrl+B"),
        item("format.italic", "Italic", "Ctrl+I"),
        item("format.strikethrough", "Strikethrough"),
        item("format.highlight", "Highlight"),
        separator(),
        item("format.code", "Inline Code", "Ctrl+E"),
        item("format.link", "Link", "Ctrl+K"),
        separator(),
        item("format.clearFormatting", "Clear Formatting"),
      ],
    },
    {
      kind: "submenu",
      label: "Paragraph",
      items: [
        item("format.list", "Bullet List"),
        item("format.orderedList", "Numbered List"),
        item("format.taskList", "Task List"),
        separator(),
        ...Array.from({ length: 6 }, (_, index) => {
          const level = index + 1;
          return item(`format.heading${level}`, `Heading ${level}`, `Ctrl+${level}`);
        }),
        separator(),
        item("format.clearHeading", "Remove Heading", "Ctrl+0"),
      ],
    },
    {
      kind: "submenu",
      label: "Insert",
      items: [
        item("format.table", "Table"),
        item("format.callout", "Callout"),
        item("format.codeBlock", "Code Block", "Ctrl+Shift+K"),
        item("format.mathBlock", "Math Block"),
        item("format.horizontalRule", "Horizontal Rule"),
      ],
    },
    separator(),
    item("cut", "Cut", "Ctrl+X", !options.hasSelection),
    item("copy", "Copy", "Ctrl+C", !options.hasSelection),
    item("paste", "Paste", "Ctrl+V"),
    item("edit.pastePlainText", "Paste as Plain Text", "Ctrl+Shift+V"),
    item("delete", "Delete", undefined, !options.hasSelection),
    item("select-all", "Select All", "Ctrl+A"),
  ];
}
