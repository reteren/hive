import { ChangeSet, EditorSelection, Transaction, type ChangeSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { parseListLine } from "./listCommands";

export type ListToggle = "bullet" | "ordered" | "task" | "quote";
export type MarkdownBlock = "table" | "callout" | "math" | "horizontalRule";

/** Insert one of the Markdown blocks offered by MarkNote's Insert submenu. */
export function insertMarkdownBlock(view: EditorView, kind: MarkdownBlock): boolean {
  const { state } = view;
  const range = state.selection.main;
  let insert: string;
  let cursorOffset: number;
  if (kind === "table") {
    const suffix = state.sliceDoc(range.to);
    insert = `|  |  |\n| --- | --- |\n|  |  |\n${suffix.startsWith("\n") ? "" : "\n"}`;
    cursorOffset = 2;
  } else if (kind === "callout") {
    insert = "> [!NOTE] Note\n> \n";
    cursorOffset = 17;
  } else if (kind === "math") {
    insert = "$$\n\n$$\n";
    cursorOffset = 3;
  } else {
    const before = state.sliceDoc(0, range.from);
    const prefix = before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    insert = `${prefix}---\n`;
    cursorOffset = insert.length;
  }

  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: EditorSelection.cursor(range.from + cursorOffset),
    annotations: Transaction.userEvent.of("input.format"),
    scrollIntoView: true,
  });
  return true;
}

/** Toggle a Markdown line marker on every line touched by the selection. */
export function toggleMarkdownLines(view: EditorView, kind: ListToggle): boolean {
  const { state } = view;
  const lineNumbers = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    let last = state.doc.lineAt(range.to).number;
    if (last > first && state.doc.line(last).from === range.to) last -= 1;
    for (let number = first; number <= last; number += 1) lineNumbers.add(number);
  }

  const lines = [...lineNumbers].sort((a, b) => a - b).map((number) => state.doc.line(number));
  const isMarked = (text: string): boolean => {
    if (kind === "quote") return /^\s*> ?/u.test(text);
    const item = parseListLine(text);
    if (!item) return false;
    if (kind === "bullet") return item.number === null && !item.task;
    if (kind === "ordered") return item.number !== null;
    return Boolean(item.task);
  };
  const remove = lines.length > 0 && lines.every((line) => isMarked(line.text));
  const changes: ChangeSpec[] = [];
  let orderedNumber = 1;

  for (const line of lines) {
    const indent = /^\s*/u.exec(line.text)?.[0] ?? "";
    const body = line.text.slice(indent.length);
    let next: string;
    if (remove) {
      next = kind === "quote" ? line.text.replace(/^(\s*)> ?/u, "$1") : removeListMarker(line.text);
    } else if (kind === "quote") {
      next = `${indent}> ${body.replace(/^(?:> ?)+/u, "")}`;
    } else {
      const content = listContent(line.text);
      const marker = kind === "bullet" ? "- "
        : kind === "ordered" ? `${orderedNumber++}. `
          : "- [ ] ";
      next = `${indent}${marker}${content}`;
    }
    if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next });
  }

  if (changes.length) {
    const changeSet = ChangeSet.of(changes, state.doc.length);
    view.dispatch({
      changes: changeSet,
      selection: state.selection.map(changeSet),
      annotations: Transaction.userEvent.of("input.format"),
    });
  }
  return true;
}

function removeListMarker(text: string): string {
  const item = parseListLine(text);
  if (!item) return text;
  return text.slice(0, item.indent.length) + text.slice(item.contentStart);
}

function listContent(text: string): string {
  const item = parseListLine(text);
  return item ? text.slice(item.contentStart) : text.slice((/^\s*/u.exec(text)?.[0] ?? "").length);
}
