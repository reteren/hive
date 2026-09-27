import { defaultKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { EditorState, Transaction } from "@codemirror/state";
import { Decoration, drawSelection, EditorView, keymap, ViewPlugin, type DecorationSet } from "@codemirror/view";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Note } from "../model/note";
import { history, record, type HistoryCommand } from "../history/history.svelte";
import { board, updateNote } from "../model/board.svelte";
import { preferences } from "../settings/preferences.svelte";
import { growWidthToTextMinimum, maximumNoteWidthForKind } from "../notes/layout.svelte";
import { runCommand } from "../commands/registry.svelte";
import { teleportToObject, teleportToPoint } from "../navigation/navigate";
import { showLinkStatus } from "../links-in-text/contextMenu.svelte";
import { parseTextLink, textLinkStyleClass } from "../links-in-text/format";
import { attachEditor, editorForNote, exitNoteEditing } from "./editorSession";
import { toggleHeading, toggleWrapper } from "./formatting";
import { coloredHighlights, getContrastingTextColor } from "./highlight";
import { openHighlightPalette } from "./highlightPalette";
import { hiveMarkdownExtensions } from "./markdownSyntax";
import { collapsedLinkMarkup, visibleMarkdownLinksInTree } from "./linkPreview";
import { applyTextEditEffects, captureTextEditEffects } from "../transfer/textEditHooks";
import { measureAndCacheTextMinimumWidth } from "./textFitWidth";
import { spellcheckExtension } from "../spell/spellcheck";
import { spellSettings } from "../spell/settings.svelte";
import {
  createTextEditRecord,
  mergeTextEditRecords,
  replayTextEditRecord,
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
  const highlightColors = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = highlightDecorations(view);
      }

      update(update: import("@codemirror/view").ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = highlightDecorations(update.view);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
  const linkPreview = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      atomicRanges: DecorationSet = Decoration.none;

      constructor(view: EditorView) {
        this.rebuild(view);
      }

      update(update: import("@codemirror/view").ViewUpdate): void {
        if (update.docChanged || update.selectionSet || update.viewportChanged) this.rebuild(update.view);
      }

      private rebuild(view: EditorView): void {
        const state = view.state;
        const text = state.doc.toString();
        const links = visibleMarkdownLinksInTree(syntaxTree(state), text, view.visibleRanges);
        const hidden = collapsedLinkMarkup(links, state.selection);
        const decorations = links.flatMap((link) => {
          if (link.labelTo <= link.labelFrom) return [];
          const missing = link.target.kind === "note" && !board.notes[link.target.noteId];
          const classes = `cm-hive-link ${textLinkStyleClass(link.target)}${missing ? " is-missing" : ""}`;
          return [Decoration.mark({
            class: classes,
            attributes: {
              "data-hive-link": link.url,
              title: "Ctrl+click to follow link",
            },
          }).range(link.labelFrom, link.labelTo)];
        });
        const replacements = hidden.map((range) => Decoration.replace({}).range(range.from, range.to));
        this.decorations = Decoration.set([...decorations, ...replacements], true);
        this.atomicRanges = Decoration.set(replacements, true);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
  const extensions = [
    markdown({ extensions: hiveMarkdownExtensions }),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    EditorView.lineWrapping,
    drawSelection(),
    highlightColors,
    linkPreview,
    spellcheckExtension(() => ({ enabled: spellSettings.enabled, languages: spellSettings.languages })),
    EditorView.atomicRanges.of((view) => view.plugin(linkPreview)?.atomicRanges ?? Decoration.none),
    EditorView.domEventHandlers({
      mousedown(event) {
        if (event.button !== 0 || (!event.ctrlKey && !event.metaKey)) return false;
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-hive-link]") : null;
        const url = target?.dataset.hiveLink;
        if (!url) return false;

        event.preventDefault();
        event.stopPropagation();
        followTextLink(url);
        return true;
      },
    }),
    keymap.of([
      { key: "Escape", run: (view) => (exitNoteEditing(view), true) },
      { key: "Mod-b", run: (view) => toggleWrapper(view, "**") },
      { key: "Mod-i", run: (view) => toggleWrapper(view, "*") },
      { key: "Mod-Shift-x", run: (view) => toggleWrapper(view, "~~") },
      { key: "Mod-e", run: (view) => toggleWrapper(view, "`") },
      { key: "Mod-1", run: toggleHeading },
      { key: "Mod-Shift-h", run: openHighlightPalette },
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

      edit.transferEffects = captureTextEditEffects(noteId, before.toString(), after.toString());
      const textMinimum = measureAndCacheTextMinimumWidth(noteId, after.toString(), update.view.contentDOM, note.type);
      const currentWidth = board.notes[noteId]?.width ?? note.width;
      const nextWidth = preferences.fitWidthToText && textMinimum !== null
        ? growWidthToTextMinimum(currentWidth, textMinimum, maximumNoteWidthForKind(note.type))
        : currentWidth;
      if (nextWidth > currentWidth) {
        edit.widthBefore = currentWidth;
        edit.widthAfter = nextWidth;
      }

      updateNote(noteId, nextWidth > currentWidth
        ? { text: after.toString(), width: nextWidth }
        : { text: after.toString() });
      applyTextEditEffects(edit.transferEffects, "redo");
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
        ".cm-hive-link": {
          color: "#83b8e8",
          cursor: "pointer",
          textDecorationColor: "#557998",
          textDecorationLine: "underline",
          textUnderlineOffset: "2px",
        },
        ".cm-hive-link.is-note-link": {
          textDecorationColor: "#83b8e8",
          textDecorationLine: "overline underline",
        },
        ".cm-hive-link.is-point-link": { textDecorationStyle: "dotted" },
        ".cm-hive-link.is-missing": {
          color: "#d88982",
          textDecorationColor: "#8d5550",
        },
        ".hive-highlight-palette": {
          position: "absolute",
          top: "0",
          left: "0",
          zIndex: "20",
          display: "flex",
          alignItems: "center",
          gap: "5px",
          padding: "5px 7px",
          border: "1px solid #505050",
          borderRadius: "4px",
          backgroundColor: "var(--bg-panel)",
          boxShadow: "0 3px 10px rgba(0, 0, 0, 0.55)",
        },
        ".hive-highlight-title": {
          paddingRight: "2px",
          color: "var(--text-dim)",
          fontFamily: "var(--ui-font)",
          fontSize: "11px",
        },
        ".hive-highlight-swatch": {
          width: "18px",
          height: "18px",
          padding: "0",
          border: "1px solid rgba(0, 0, 0, 0.45)",
          borderRadius: "50%",
          cursor: "pointer",
        },
        ".hive-highlight-swatch:hover, .hive-highlight-swatch:focus-visible": {
          transform: "scale(1.12)",
          outline: "2px solid #ffffff",
          outlineOffset: "1px",
        },
      },
      { dark: true },
    ),
  ];

  const state = EditorState.create({ doc: note.text, extensions });
  const view = new EditorView({ parent, state });
  attachEditor(noteId, view);
  return view;
}

function followTextLink(value: string): void {
  const target = parseTextLink(value);
  if (!target) return;

  try {
    if (target.kind === "external") {
      void Promise.resolve(openUrl(target.url)).catch(() => showLinkStatus("Could not open this link."));
    } else if (target.kind === "point") {
      teleportToPoint(target.point, { label: "Text link" });
    } else if (!board.notes[target.noteId] || !teleportToObject(target.noteId, { label: "Text link" })) {
      showLinkStatus("This note is missing.");
    }
  } catch {
    showLinkStatus("Could not open this link.");
  }
}

function highlightDecorations(view: EditorView): DecorationSet {
  const source = view.state.doc.toString();
  return Decoration.set(
    coloredHighlights(source).map((highlight) =>
      Decoration.mark({
        class: "cm-hive-highlight",
        attributes: {
          style: `background-color:${highlight.color};color:${getContrastingTextColor(highlight.color)}`,
        },
      }).range(highlight.from, highlight.to),
    ),
  );
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
  const expectedText = forward ? edit.before : edit.after;
  const changes = forward ? edit.forward : edit.inverse;
  const selection = forward ? edit.selectionAfter : edit.selectionBefore;

  replayTextEditRecord(edit, direction, (nextText) => {
    const width = direction === "redo" ? edit.widthAfter : edit.widthBefore;
    updateNote(edit.noteId, width === undefined ? { text: nextText } : { text: nextText, width });
    const view = editorForNote(edit.noteId);
    if (!view) return;

    const currentText = view.state.doc.toString();
    const transactionChanges =
      currentText === expectedText.toString()
        ? changes
        : { from: 0, to: view.state.doc.length, insert: nextText };
    view.dispatch({
      changes: transactionChanges,
      selection: currentText === expectedText.toString() ? selection : undefined,
      annotations: Transaction.addToHistory.of(false),
    });
  });
}
