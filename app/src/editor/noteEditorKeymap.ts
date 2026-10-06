import {
  defaultKeymap,
  deleteLine,
  moveLineDown,
  moveLineUp,
} from "@codemirror/commands";
import type { Extension } from "@codemirror/state";
import { keymap, type Command, type KeyBinding } from "@codemirror/view";
import { toggleHeadingLevel, toggleWrapper } from "./formatting";
import { toggleMarkdownLines } from "./markdownCommands";
import { continueMarkdownList, removeIndentUnit, shiftIndentation, softBreak } from "./listCommands";

export type NoteEditorKeymapOptions = {
  exit: Command;
  undo: Command;
  redo: Command;
  highlight: Command;
};

export function noteEditorKeymap(options: NoteEditorKeymapOptions): Extension {
  return keymap.of(noteEditorKeyBindings(options));
}

export function noteEditorKeyBindings(options: NoteEditorKeymapOptions): KeyBinding[] {
  const markdown = (run: Command): Command => (view) => run(view);
  const bindings: KeyBinding[] = [
    { key: "Escape", run: options.exit },
    { key: "Mod-z", run: options.undo },
    { key: "Mod-Shift-z", run: options.redo },
    { key: "Mod-y", run: options.redo },
    { key: "Alt-Backspace", run: () => true, preventDefault: true },
    { key: "Tab", run: (view) => shiftIndentation(view, 1) },
    { key: "Shift-Tab", run: (view) => shiftIndentation(view, -1) },
    { key: "Shift-Enter", run: markdown(softBreak) },
    { key: "Enter", run: markdown(continueMarkdownList) },
    { key: "Backspace", run: markdown(removeIndentUnit) },
    { key: "Mod-b", run: (view) => toggleWrapper(view, "**") },
    { key: "Mod-i", run: (view) => toggleWrapper(view, "*") },
    { key: "Mod-Shift-x", run: (view) => toggleWrapper(view, "~~") },
    { key: "Mod-e", run: (view) => toggleWrapper(view, "`") },
    { key: "Mod-d", run: deleteLine },
    { key: "Alt-ArrowUp", run: moveLineUp },
    { key: "Alt-ArrowDown", run: moveLineDown },
    { key: "Mod-k", run: toggleLink },
    { key: "Mod-Shift-k", run: toggleCodeBlock },
    { key: "Mod-Shift-v", run: pastePlainText },
    { key: "Mod-Shift-8", run: (view) => toggleMarkdownLines(view, "bullet") },
    { key: "Mod-Shift-7", run: (view) => toggleMarkdownLines(view, "ordered") },
    { key: "Mod-Shift-9", run: (view) => toggleMarkdownLines(view, "task") },
    { key: "Mod-Shift-.", run: (view) => toggleMarkdownLines(view, "quote") },
    { key: "Mod-Shift-h", run: options.highlight },
  ];
  for (let level = 1; level <= 6; level += 1) {
    bindings.push({ key: `Mod-${level}`, run: (view) => toggleHeadingLevel(view, level) });
  }
  bindings.push({ key: "Mod-0", run: (view) => toggleHeadingLevel(view, 0) });
  bindings.push({
    any(view, event) {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return false;
      const kind = event.code === "Digit8" ? "bullet"
        : event.code === "Digit7" ? "ordered"
          : event.code === "Digit9" ? "task"
            : event.code === "Period" ? "quote"
              : null;
      return kind ? toggleMarkdownLines(view, kind) : false;
    },
  });
  bindings.push(...defaultKeymap.filter((binding) => binding.key !== "Mod-Enter"));
  return bindings;
}

export function toggleLink(view: Parameters<Command>[0]): boolean {
  const range = view.state.selection.main;
  const text = view.state.sliceDoc(range.from, range.to);
  if (range.empty) {
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: "[](url)" },
      selection: { anchor: range.from + 1 },
    });
  } else {
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: `[${text}](url)` },
      selection: { anchor: range.from + text.length + 3, head: range.from + text.length + 6 },
    });
  }
  return true;
}

export function toggleCodeBlock(view: Parameters<Command>[0]): boolean {
  const range = view.state.selection.main;
  const from = view.state.doc.lineAt(range.from).from;
  const to = view.state.doc.lineAt(range.to).to;
  const text = view.state.sliceDoc(from, to);
  const trimmed = text.trim();
  if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
    const lines = text.split("\n");
    view.dispatch({ changes: { from, to, insert: lines.slice(1, -1).join("\n") } });
  } else {
    view.dispatch({
      changes: { from, to, insert: `\`\`\`\n${text}\n\`\`\`` },
      selection: { anchor: range.from + 4, head: range.to + 4 },
    });
  }
  return true;
}

export function pastePlainText(view: Parameters<Command>[0]): boolean {
  if (typeof navigator === "undefined" || !navigator.clipboard?.readText) return false;
  void navigator.clipboard.readText().then((text) => view.dispatch(view.state.replaceSelection(text))).catch(() => undefined);
  return true;
}
