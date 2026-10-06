// Indentation and list editing commands.
//
// The rules follow Obsidian, which the owner reproduced by hand:
// - Tab indents the whole line by one indent unit, wherever the caret is;
//   Shift+Tab and Backspace at the start of the text remove one unit.
// - A number the user types is never rewritten. "8. " starts a list at 8.
// - Enter continues a list with the next number; Enter on an empty item
//   removes the marker (top level) or moves the item out one level (nested).
// - Shift+Enter continues the item on a new line one indent unit deeper,
//   without a marker; Enter on such a line keeps its indentation.
// Numbers change only inside these commands, and only where the command
// itself changed the list structure.

import { getIndentUnit, indentString, syntaxTree } from "@codemirror/language";
import { insertNewlineAndIndent } from "@codemirror/commands";
import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { EditorSelection, type ChangeSpec, type EditorState, type Line } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export type ListLine = {
  /** Leading whitespace before the marker. */
  indent: string;
  /** Ordered number, or null for a bullet. */
  number: number | null;
  /** "." or ")" for ordered items, the bullet character otherwise. */
  delimiter: string;
  /** Length of the marker itself ("15." is 3, "-" is 1). */
  markerLength: number;
  /** Whitespace between the marker and the content. */
  spacing: string;
  /** "[ ] " or "[x] " including its trailing whitespace, or "". */
  task: string;
  /** Offset in the line where the item's text starts. */
  contentStart: number;
};

const listLinePattern = /^(?<indent>[ \t]*)(?:(?<number>\d{1,9})(?<delimiter>[.)])|(?<bullet>[-+*]))(?<spacing>[ \t]+)(?<task>\[[ xX]\][ \t]+)?/u;

/** Parses a list item line; the marker must be followed by whitespace. */
export function parseListLine(text: string): ListLine | null {
  const match = listLinePattern.exec(text);
  if (!match?.groups) return null;
  const groups = match.groups;
  const number = groups.number === undefined ? null : Number.parseInt(groups.number, 10);
  const marker = groups.number !== undefined ? groups.number + groups.delimiter : groups.bullet;
  return {
    indent: groups.indent ?? "",
    number,
    delimiter: groups.number !== undefined ? groups.delimiter : groups.bullet,
    markerLength: marker.length,
    spacing: groups.spacing,
    task: groups.task ?? "",
    contentStart: match[0].length,
  };
}

/** Visual columns of leading whitespace, with tabs advancing to the next tab stop. */
export function leadingColumns(text: string, tabSize: number): number {
  let columns = 0;
  for (const character of text) {
    if (character === " ") columns += 1;
    else if (character === "\t") columns += tabSize - (columns % tabSize);
    else break;
  }
  return columns;
}

export function leadingWhitespace(text: string): string {
  return /^[ \t]*/u.exec(text)?.[0] ?? "";
}

/** How many whole indent units the line starts with. */
export function indentLevels(text: string, state: EditorState): number {
  const unit = Math.max(1, getIndentUnit(state));
  return Math.floor(leadingColumns(text, state.tabSize) / unit);
}

function isBlankOrBoundary(text: string): boolean {
  return /^[ \t]*$/u.test(text) || /^[ \t]{0,3}(?:#{1,6}(?:[ \t]|$)|`{3,}|~{3,})/u.test(text);
}

function insideCode(state: EditorState, position: number): boolean {
  for (let node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(position, -1); node; node = node.parent) {
    if (node.name === "FencedCode") return true;
  }
  return false;
}

/** Removes one indent unit from the end of `indent`, as Backspace and Shift+Tab do. */
function withoutOneUnit(indent: string, state: EditorState): string {
  if (!indent.length) return indent;
  if (indent.endsWith("\t")) return indent.slice(0, -1);
  const unit = Math.max(1, getIndentUnit(state));
  const columns = leadingColumns(indent, state.tabSize);
  const remove = columns % unit || unit;
  let spaces = 0;
  while (spaces < remove && indent[indent.length - 1 - spaces] === " ") spaces += 1;
  return indent.slice(0, indent.length - spaces);
}

type Sibling = { line: Line; item: ListLine };

/**
 * Walks the ordered items that follow `lineNumber` at exactly `columns` of
 * indentation, inside the same list: deeper lines and continuation lines are
 * skipped, a shallower item or a blank line / heading ends the walk.
 */
function followingSiblings(state: EditorState, lineNumber: number, columns: number): Sibling[] {
  const result: Sibling[] = [];
  for (let number = lineNumber + 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    if (isBlankOrBoundary(line.text)) break;
    const item = parseListLine(line.text);
    if (!item) continue;
    const itemColumns = leadingColumns(item.indent, state.tabSize);
    if (itemColumns < columns) break;
    if (itemColumns > columns) continue;
    if (item.number === null) break;
    result.push({ line, item });
  }
  return result;
}

/** The nearest item above at `columns` in the same list, or null at a parent or the list's start. */
function previousSibling(state: EditorState, lineNumber: number, columns: number): Sibling | null {
  for (let number = lineNumber - 1; number >= 1; number -= 1) {
    const line = state.doc.line(number);
    if (isBlankOrBoundary(line.text)) return null;
    const item = parseListLine(line.text);
    if (!item) continue;
    const itemColumns = leadingColumns(item.indent, state.tabSize);
    if (itemColumns === columns) return { line, item };
    if (itemColumns < columns) return null;
  }
  return null;
}

function numberChange(line: Line, item: ListLine, value: number): ChangeSpec {
  const from = line.from + item.indent.length;
  return { from, to: from + item.markerLength - 1, insert: String(value) };
}

/**
 * Renumbers `siblings` to continue from `start`, but only while the original
 * numbers were consecutive: a hand-made jump (1, 2, 7) is left alone from the
 * jump on. Returns the edits for numbers that actually change.
 */
function continueSequence(siblings: Sibling[], start: number, expectedFirst: number): ChangeSpec[] {
  const changes: ChangeSpec[] = [];
  let expectedOriginal = expectedFirst;
  let next = start;
  for (const sibling of siblings) {
    if (sibling.item.number !== expectedOriginal) break;
    if (sibling.item.number !== next) changes.push(numberChange(sibling.line, sibling.item, next));
    expectedOriginal += 1;
    next += 1;
  }
  return changes;
}

/**
 * Number edits after an ordered item at `lineNumber` moved from `oldColumns`
 * to its current indentation in `state` (Tab or Shift+Tab on one item).
 */
function renumberAfterMove(state: EditorState, lineNumber: number, oldColumns: number, oldNumber: number): ChangeSpec[] {
  const line = state.doc.line(lineNumber);
  const item = parseListLine(line.text);
  if (!item || item.number === null) return [];
  const columns = leadingColumns(item.indent, state.tabSize);
  const changes: ChangeSpec[] = [];

  // The item's number in its new list: after its new previous sibling, or 1
  // when it opens a nested list. Moving out with no sibling above keeps it.
  const before = previousSibling(state, lineNumber, columns);
  let value = item.number;
  if (before?.item.number != null) value = before.item.number + 1;
  else if (columns > oldColumns) value = 1;
  if (value !== item.number) changes.push(numberChange(line, item, value));

  // The list it joined continues after it; the list it left closes the gap.
  changes.push(...continueSequence(followingSiblings(state, lineNumber, columns), value + 1, value));
  if (columns > oldColumns) {
    const left = followingSiblings(state, lineNumber, oldColumns);
    changes.push(...continueSequence(left, oldNumber, oldNumber + 1));
  } else {
    const nowChildren = followingSiblings(state, lineNumber, oldColumns);
    changes.push(...continueSequence(nowChildren, 1, oldNumber + 1));
  }
  return changes;
}

/** Tab (dir 1) or Shift+Tab (dir -1): one indent unit at the start of every touched line. */
export function shiftIndentation(view: EditorView, direction: 1 | -1): boolean {
  const { state } = view;
  const unit = indentString(state, Math.max(1, getIndentUnit(state)));
  const lineNumbers = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    let last = state.doc.lineAt(range.to).number;
    // A selection ending at the very start of a line does not touch that line.
    if (last > first && state.doc.line(last).from === range.to) last -= 1;
    for (let number = first; number <= last; number += 1) lineNumbers.add(number);
  }
  const multiLine = lineNumbers.size > 1;

  const changes: ChangeSpec[] = [];
  const moved: Array<{ lineNumber: number; oldColumns: number; oldNumber: number }> = [];
  for (const number of [...lineNumbers].sort((a, b) => a - b)) {
    const line = state.doc.line(number);
    if (multiLine && direction === 1 && /^[ \t]*$/u.test(line.text)) continue;
    const leading = leadingWhitespace(line.text);
    const replacement = direction === 1 ? leading + unit : withoutOneUnit(leading, state);
    if (replacement === leading) continue;
    changes.push({ from: line.from, to: line.from + leading.length, insert: replacement });
    const item = parseListLine(line.text);
    if (!multiLine && item?.number != null) {
      moved.push({ lineNumber: number, oldColumns: leadingColumns(leading, state.tabSize), oldNumber: item.number });
    }
  }
  if (!changes.length) return true;

  const changeSet = state.changes(changes);
  // Keep every caret with its text, including a caret at the start of the line.
  const selection = EditorSelection.create(
    state.selection.ranges.map((range) =>
      EditorSelection.range(changeSet.mapPos(range.anchor, 1), changeSet.mapPos(range.head, 1)),
    ),
    state.selection.mainIndex,
  );
  const indented = state.update({ changes: changeSet }).state;
  const renumber = moved.flatMap((entry) => renumberAfterMove(indented, entry.lineNumber, entry.oldColumns, entry.oldNumber));
  view.dispatch(
    { changes: changeSet, selection, userEvent: direction === 1 ? "input.indent" : "delete.dedent", scrollIntoView: true },
    ...(renumber.length ? [{ changes: renumber, sequential: true }] : []),
  );
  return true;
}

/** Enter: continues lists and indented lines as described at the top of this file. */
export function continueMarkdownList(view: EditorView): boolean {
  const { state } = view;
  if (state.selection.ranges.length !== 1) return insertNewlineAndIndent(view);
  const range = state.selection.main;
  if (insideCode(state, range.head)) return insertNewlineAndIndent(view);
  const line = state.doc.lineAt(range.from);
  const column = range.from - line.from;
  const item = parseListLine(line.text);

  if (item && column >= item.contentStart) {
    const content = line.text.slice(item.contentStart);
    if (/^[ \t]*$/u.test(content) && range.empty && range.head === line.to) {
      if (!item.indent.length) {
        // An empty top-level item disappears, as if it had never been typed.
        view.dispatch({
          changes: { from: line.from, to: line.to },
          selection: EditorSelection.cursor(line.from),
          userEvent: "delete",
          scrollIntoView: true,
        });
        return true;
      }
      return shiftIndentation(view, -1);
    }

    const nextNumber = item.number === null ? null : item.number + 1;
    const marker = nextNumber === null ? item.delimiter : `${nextNumber}${item.delimiter}`;
    const task = item.task ? "[ ] " : "";
    const insert = `\n${item.indent}${marker} ${task}`;
    const changes: ChangeSpec[] = [{ from: range.from, to: range.to, insert }];
    const cursor = range.from + insert.length;

    if (nextNumber !== null) {
      // Items after the new one shift by one while they were consecutive.
      const columns = leadingColumns(item.indent, state.tabSize);
      const siblings = followingSiblings(state, line.number, columns);
      changes.push(...continueSequence(siblings, nextNumber + 1, nextNumber));
    }
    view.dispatch({
      changes,
      selection: EditorSelection.cursor(cursor),
      userEvent: "input",
      scrollIntoView: true,
    });
    return true;
  }

  if (/^[ \t]*>/u.test(line.text) && insertNewlineContinueMarkup(view)) return true;

  const leading = leadingWhitespace(line.text);
  if (leading.length && column >= leading.length) {
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: `\n${leading}` },
      selection: EditorSelection.cursor(range.from + 1 + leading.length),
      userEvent: "input",
      scrollIntoView: true,
    });
    return true;
  }
  return insertNewlineAndIndent(view);
}

/** Shift+Enter: a new line without a marker, one indent unit under a list item. */
export function softBreak(view: EditorView): boolean {
  const { state } = view;
  const unit = indentString(state, Math.max(1, getIndentUnit(state)));
  const transaction = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.from);
    const item = parseListLine(line.text);
    const indent = item ? item.indent + unit : leadingWhitespace(line.text.slice(0, range.from - line.from));
    const insert = `\n${indent}`;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(range.from + insert.length),
    };
  });
  view.dispatch(transaction, { userEvent: "input", scrollIntoView: true });
  return true;
}

/** Backspace at the start of an indented line's text removes one indent unit. */
export function removeIndentUnit(view: EditorView): boolean {
  const { state } = view;
  if (state.selection.ranges.length !== 1) return false;
  const range = state.selection.main;
  if (!range.empty) return false;
  const line = state.doc.lineAt(range.head);
  const leading = leadingWhitespace(line.text);
  if (!leading.length || range.head !== line.from + leading.length) return false;
  if (insideCode(state, range.head)) return false;
  const kept = withoutOneUnit(leading, state);
  view.dispatch({
    changes: { from: line.from + kept.length, to: line.from + leading.length },
    selection: EditorSelection.cursor(line.from + kept.length),
    userEvent: "delete.dedent",
    scrollIntoView: true,
  });
  return true;
}
