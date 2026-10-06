import { ChangeSet, EditorSelection, Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export function toggleWrapper(view: EditorView, wrapper: string): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  const doc = state.doc;

  if (from !== to) {
    const hasWrapper =
      from >= wrapper.length &&
      to + wrapper.length <= doc.length &&
      doc.sliceString(from - wrapper.length, from) === wrapper &&
      doc.sliceString(to, to + wrapper.length) === wrapper;
    if (hasWrapper) {
      view.dispatch({
        changes: [
          { from: from - wrapper.length, to: from },
          { from: to, to: to + wrapper.length },
        ],
        selection: { anchor: from - wrapper.length, head: to - wrapper.length },
        annotations: Transaction.userEvent.of("input.format"),
      });
      return true;
    }

    const changes = [
      { from, insert: wrapper },
      { from: to, insert: wrapper },
    ];
    view.dispatch({
      changes,
      selection: { anchor: from + wrapper.length, head: to + wrapper.length },
      annotations: Transaction.userEvent.of("input.format"),
    });
    return true;
  }

  const line = doc.lineAt(from);
  const local = from - line.from;
  const word = /[\p{L}\p{N}_]+/u;
  let start = local;
  let end = local;
  while (start > 0 && word.test(line.text[start - 1])) start -= 1;
  while (end < line.text.length && word.test(line.text[end])) end += 1;

  const wordFrom = line.from + start;
  const wordTo = line.from + end;
  const surrounding =
    wordFrom >= wrapper.length &&
    wordTo + wrapper.length <= doc.length &&
    doc.sliceString(wordFrom - wrapper.length, wordFrom) === wrapper &&
    doc.sliceString(wordTo, wordTo + wrapper.length) === wrapper;

  if (surrounding) {
    const innerFrom = wordFrom - wrapper.length;
    view.dispatch({
      changes: [
        { from: innerFrom, to: wordFrom },
        { from: wordTo, to: wordTo + wrapper.length },
      ],
      selection: { anchor: Math.max(innerFrom, from - wrapper.length) },
      annotations: Transaction.userEvent.of("input.format"),
    });
    return true;
  }

  if (wordFrom !== wordTo) {
    const text = doc.sliceString(wordFrom, wordTo);
    view.dispatch({
      changes: { from: wordFrom, to: wordTo, insert: `${wrapper}${text}${wrapper}` },
      selection: { anchor: wordFrom + wrapper.length, head: wordTo + wrapper.length },
      annotations: Transaction.userEvent.of("input.format"),
    });
    return true;
  }

  view.dispatch({
    changes: { from, insert: wrapper + wrapper },
    selection: { anchor: from + wrapper.length },
    annotations: Transaction.userEvent.of("input.format"),
  });
  return true;
}

export function toggleHeading(view: EditorView): boolean {
  return toggleHeadingLevel(view, 1);
}

export function toggleHeadingLevel(view: EditorView, level: number): boolean {
  const { state } = view;
  const touched = new Set<number>();
  const changes: { from: number; to: number; insert: string }[] = [];

  for (const range of state.selection.ranges) {
    const firstLine = state.doc.lineAt(range.from).number;
    const lastLine = state.doc.lineAt(range.to).number;
    for (let number = firstLine; number <= lastLine; number += 1) {
      if (touched.has(number)) continue;
      touched.add(number);
      const line = state.doc.line(number);
      const match = /^(\s*)(#{1,6})(?:\s+|$)/u.exec(line.text);
      const indent = match?.[1] ?? line.text.match(/^\s*/u)?.[0] ?? "";
      const body = match ? line.text.slice(match[0].length) : line.text.slice(indent.length);
      const nextLevel = level === 0 || match?.[2].length === level ? 0 : level;
      const next = nextLevel === 0 ? `${indent}${body}` : `${indent}${"#".repeat(nextLevel)} ${body}`;
      if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next });
    }
  }

  if (changes.length === 0) return true;

  const changeSet = ChangeSet.of(changes, state.doc.length);
  let selection = state.selection.map(changeSet);
  const main = state.selection.main;
  if (main.empty && level > 0) {
    const line = state.doc.lineAt(main.head);
    const original = line.text;
    const currentLevel = /^\s*(#{1,6})(?:\s+|$)/u.exec(original)?.[1].length ?? 0;
    if (currentLevel !== level) {
      const indent = original.match(/^\s*/u)?.[0].length ?? 0;
      const mappedLineStart = changeSet.mapPos(line.from, -1);
      selection = EditorSelection.create([EditorSelection.cursor(mappedLineStart + indent + level + 1)]);
    }
  }

  view.dispatch({
    changes: changeSet,
    selection,
    annotations: Transaction.userEvent.of("input.format"),
  });
  return true;
}

/** Remove inline Markdown styling from the current selection or word. */
export function clearFormatting(view: EditorView): boolean {
  const state = view.state;
  const pairs = ["**", "~~", "==", "*", "`"];
  const ranges = state.selection.ranges.filter((range) => !range.empty);
  const targets = ranges.length > 0
    ? ranges.map((range) => ({ from: range.from, to: range.to }))
    : [wordRangeAtCursor(state) ?? { from: state.selection.main.from, to: state.selection.main.to }];
  const changes: Array<{ from: number; to: number; insert: string }> = [];

  for (const target of targets) {
    if (target.from === target.to) continue;
    let from = target.from;
    let to = target.to;
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const pair of pairs) {
        if (from >= pair.length && to + pair.length <= state.doc.length
          && state.sliceDoc(from - pair.length, from) === pair
          && state.sliceDoc(to, to + pair.length) === pair) {
          from -= pair.length;
          to += pair.length;
          expanded = true;
          break;
        }
      }
    }
    const original = state.sliceDoc(from, to);
    const stripped = stripInlineMarkup(original);
    if (stripped !== original || from !== target.from || to !== target.to) changes.push({ from, to, insert: stripped });
  }

  if (!changes.length) return false;
  const changeSet = ChangeSet.of(changes, state.doc.length);
  const selection = ranges.length > 0
    ? state.selection.map(changeSet)
    : EditorSelection.range(changeSet.mapPos(changes[0].from), changeSet.mapPos(changes[0].from) + changes[0].insert.length);
  view.dispatch({ changes: changeSet, selection, annotations: Transaction.userEvent.of("input.format") });
  return true;
}

function wordRangeAtCursor(state: EditorView["state"]): { from: number; to: number } | null {
  const cursor = state.selection.main.head;
  const line = state.doc.lineAt(cursor);
  const local = cursor - line.from;
  let from = local;
  let to = local;
  const isWord = (character: string): boolean => /[^\s*_~=`\[\]()]/u.test(character);
  while (from > 0 && isWord(line.text[from - 1] ?? "")) from -= 1;
  while (to < line.text.length && isWord(line.text[to] ?? "")) to += 1;
  return from === to ? null : { from: line.from + from, to: line.from + to };
}

function stripInlineMarkup(text: string): string {
  return text.split("\n").map((line) => {
    const marker = /^(\s*(?:#{1,6}\s+|[-+*]\s+\[[ xX]\]\s+|[-+*]\s+|\d+[.)]\s+))/u.exec(line)?.[1] ?? "";
    let body = marker ? line.slice(marker.length) : line;
    let previous: string;
    do {
      previous = body;
      body = body
        .replace(/`([^`\n]+)`/gu, "$1")
        .replace(/==([^=\n]+)==/gu, "$1")
        .replace(/~~([^~\n]+)~~/gu, "$1")
        .replace(/\*\*([^\n]+?)\*\*/gu, "$1")
        .replace(/\*([^\n]+?)\*/gu, "$1");
    } while (body !== previous);
    return marker + body;
  }).join("\n");
}
