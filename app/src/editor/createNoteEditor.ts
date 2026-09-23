import { defaultKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState, Transaction } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import type { Note } from "../model/note";
import { history, record, type HistoryCommand } from "../history/history.svelte";
import { updateNote } from "../model/board.svelte";
import { runCommand } from "../commands/registry.svelte";
import { attachEditor, editorForNote, exitNoteEditing } from "./editorSession";
import { toggleHeading, toggleWrapper } from "./formatting";
import {
  createTextEditRecord,
  mergeTextEditRecords,
  textEditKind,
  type TextEditRecord,
} from "./textEditHistory";

let selectionGroup = 0;
let observedHistoryEntries = history.entries;
let observedHistoryCursor = history.cursor;

export function breakTextEditGroup(): void {
  selectionGroup += 1;
}

export function observeHistoryBoundary(
  entries: HistoryCommand[],
  cursor: number,
): void {
  if (entries === observedHistoryEntries && cursor === observedHistoryCursor) return;
  observedHistoryEntries = entries;
  observedHistoryCursor = cursor;
  breakTextEditGroup();
}

export function createNoteEditor(parent: HTMLElement, note: Note): EditorView {
  const noteId = note.id;
  const extensions = [
    markdown(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    EditorView.lineWrapping,
    drawSelection(),
    keymap.of([
      { key: "Escape", run: (view) => (exitNoteEditing(view), true) },
      { key: "Mod-b", run: (view) => toggleWrapper(view, "**") },
      { key: "Mod-i", run: (view) => toggleWrapper(view, "*") },
      { key: "Mod-Shift-x", run: (view) => toggleWrapper(view, "~~") },
      { key: "Mod-e", run: (view) => toggleWrapper(view, "`") },
      { key: "Mod-1", run: toggleHeading },
      { key: "Mod-z", run: () => (runCommand("edit.undo"), true) },
      { key: "Mod-Shift-z", run: () => (runCommand("edit.redo"), true) },
      { key: "Mod-y", run: () => (runCommand("edit.redo"), true) },
      ...defaultKeymap,
    ]),
    EditorView.contentAttributes.of({
      "aria-label": `Text for ${note.name}`,
      spellcheck: "false",
      autocapitalize: "off",
    }),
    EditorView.updateListener.of((update) => {
      if (update.transactions.some((transaction) => transaction.annotation(Transaction.addToHistory) === false)) {
        return;
      }

      if (!update.docChanged) {
        if (update.selectionSet) breakTextEditGroup();
        return;
      }

      const before = update.startState.doc;
      const after = update.state.doc;
      const userEvent = [...update.transactions]
        .reverse()
        .find((transaction) => transaction.docChanged)
        ?.annotation(Transaction.userEvent);
      const edit = createTextEditRecord({
        noteId,
        target: note.name,
        before,
        after,
        forward: update.changes,
        selectionBefore: update.startState.selection,
        selectionAfter: update.state.selection,
        kind: textEditKind(userEvent),
        at: performance.now(),
        group: selectionGroup,
      });

      updateNote(noteId, { text: after.toString() });
      record(createHistoryCommand(edit));
      observedHistoryEntries = history.entries;
      observedHistoryCursor = history.cursor;
    }),
    EditorView.theme(
      {
        "&": {
          color: "var(--text)",
          backgroundColor: "transparent",
          fontFamily: "var(--note-font, var(--ui-font))",
          fontSize: "14px",
        },
        ".cm-scroller": {
          fontFamily: "inherit",
          lineHeight: "1.45",
          overflowX: "hidden",
        },
        ".cm-content": {
          padding: "0",
          caretColor: "var(--accent)",
          userSelect: "text",
        },
        ".cm-line": {
          padding: "0",
          lineHeight: "1.45",
          overflowWrap: "anywhere",
        },
        ".cm-gutters": { display: "none" },
        ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
        ".cm-selectionBackground, ::selection": {
          backgroundColor: "var(--bg-active) !important",
        },
        "&.cm-focused": { outline: "none" },
        ".cm-activeLine": { backgroundColor: "transparent" },
      },
      { dark: true },
    ),
  ];

  const state = EditorState.create({ doc: note.text, extensions });
  const view = new EditorView({ parent, state });
  attachEditor(noteId, view);
  return view;
}

function createHistoryCommand(edit: TextEditRecord): HistoryCommand & { edit: TextEditRecord } {
  return {
    label: "Edit text",
    target: edit.target,
    edit,
    do() {
      replayTextEdit(this.edit, "redo");
    },
    undo() {
      replayTextEdit(this.edit, "undo");
    },
    merge(next) {
      if (!isTextHistoryCommand(next)) return false;
      const merged = mergeTextEditRecords(this.edit, next.edit);
      if (!merged) return false;
      this.edit = merged;
      this.target = merged.target;
      return true;
    },
  };
}

function isTextHistoryCommand(
  command: HistoryCommand,
): command is HistoryCommand & { edit: TextEditRecord } {
  return "edit" in command && (command as { edit?: unknown }).edit !== undefined;
}

function replayTextEdit(edit: TextEditRecord, direction: "undo" | "redo"): void {
  const forward = direction === "redo";
  const nextText = forward ? edit.after : edit.before;
  const expectedText = forward ? edit.before : edit.after;
  const changes = forward ? edit.forward : edit.inverse;
  const selection = forward ? edit.selectionAfter : edit.selectionBefore;

  updateNote(edit.noteId, { text: nextText.toString() });
  const view = editorForNote(edit.noteId);
  if (!view) return;

  const currentText = view.state.doc.toString();
  const transactionChanges =
    currentText === expectedText.toString()
      ? changes
      : { from: 0, to: view.state.doc.length, insert: nextText.toString() };
  view.dispatch({
    changes: transactionChanges,
    selection: currentText === expectedText.toString() ? selection : undefined,
    annotations: Transaction.addToHistory.of(false),
  });
}
