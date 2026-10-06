import type { EditorSelection, Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

const lineScopedNodes = new Set([
  "ListMark",
  "QuoteMark",
  "HeaderMark",
  "ATXHeading1",
  "ATXHeading2",
  "ATXHeading3",
  "ATXHeading4",
  "ATXHeading5",
  "ATXHeading6",
]);

export function selectionTouchesRange(
  selection: EditorSelection,
  from: number,
  to: number,
  strictCaret = false,
): boolean {
  return selection.ranges.some((range) => {
    if (range.empty) return strictCaret
      ? range.from > from && range.from < to
      : range.from >= from && range.from <= to;
    return strictCaret
      ? range.from < to && range.to > from
      : range.from <= to && range.to >= from;
  });
}

/** MarkNote's cursor reveal rule, including line-wide block markers and boundaries. */
export function isLivePreviewNodeActive(
  node: SyntaxNode,
  selection: EditorSelection,
  doc: Text,
): boolean {
  if (node.name === "TaskMarker") {
    return selectionTouchesRange(selection, node.from, node.to, true);
  }

  if (!lineScopedNodes.has(node.name)) {
    return selectionTouchesRange(selection, node.from, node.to);
  }

  const startLine = doc.lineAt(Math.min(node.from, doc.length));
  const endLine = doc.lineAt(Math.min(node.to, doc.length));
  return selectionTouchesRange(selection, startLine.from, endLine.to);
}
