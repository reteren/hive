import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { describe, expect, it } from "vitest";
import { hiveMarkdownExtensions } from "../src/editor/markdownSyntax";
import { buildLivePreviewDecorationSets } from "../src/editor/livePreview";

function editorState(doc: string, cursor: number): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: markdown({ extensions: hiveMarkdownExtensions }),
  });
}

function nodes(state: EditorState, name: string) {
  const found: SyntaxNode[] = [];
  syntaxTree(state).iterate({
    enter(ref) {
      if (ref.node.name === name) found.push(ref.node);
    },
  });
  return found;
}

function ranges(state: EditorState) {
  const sets = buildLivePreviewDecorationSets(state, [{ from: 0, to: state.doc.length }]);
  const found: Array<{ from: number; to: number; decoration: import("@codemirror/view").Decoration }> = [];
  sets.decorations.between(0, state.doc.length, (from, to, decoration) => { found.push({ from, to, decoration }); });
  return found;
}

function hiddenRanges(state: EditorState) {
  return ranges(state).filter(({ decoration }) =>
    decoration.spec.class === undefined && decoration.spec.widget === undefined,
  );
}

describe("note editor live preview", () => {
  it.each([
    ["StrongEmphasis", "EmphasisMark", "**bold**"],
    ["Emphasis", "EmphasisMark", "*italic*"],
    ["Strikethrough", "StrikethroughMark", "~~strike~~"],
    ["InlineCode", "CodeMark", "`code`"],
    ["HiveHighlight", "HiveHighlightMark", "==highlight=={{#12abef}}"],
  ])("hides %s markup outside the node and reveals it at either boundary", (nodeName, markerName, syntax) => {
    const doc = `outside ${syntax} after`;
    const outside = editorState(doc, 0);
    const node = nodes(outside, nodeName)[0];
    expect(node).toBeDefined();
    if (!node) return;
    const markers = node.getChildren(markerName);
    const hidden = hiddenRanges(outside);
    expect(markers.length).toBeGreaterThanOrEqual(2);
    for (const marker of markers) expect(hidden).toContainEqual(expect.objectContaining({ from: marker.from, to: marker.to }));

    for (const cursor of [node.from, node.from + 1, node.to]) {
      expect(hiddenRanges(editorState(doc, cursor))).toEqual([]);
    }
  });

  it("reveals heading and list markers for their whole line", () => {
    const headingText = "outside\n# Heading";
    const headingState = editorState(headingText, 0);
    const heading = nodes(headingState, "ATXHeading1")[0];
    expect(heading).toBeDefined();
    if (!heading) return;
    const headerMark = heading.getChild("HeaderMark");
    expect(headerMark).toBeDefined();
    expect(hiddenRanges(headingState)).toContainEqual(expect.objectContaining({ from: headerMark?.from, to: (headerMark?.to ?? 0) + 1 }));
    expect(hiddenRanges(editorState(headingText, heading.to - 1))).toEqual([]);

    const bulletText = "outside\n- item";
    const bulletState = editorState(bulletText, 0);
    const bullet = nodes(bulletState, "ListMark")[0];
    expect(bullet).toBeDefined();
    if (!bullet) return;
    const inactiveBullet = ranges(bulletState).find(({ from, to }) => from === bullet.from && to === bullet.to);
    expect(inactiveBullet?.decoration.spec.widget?.constructor.name).toBe("PreviewTextWidget");
    const activeBullet = editorState(bulletText, bullet.from);
    expect(ranges(activeBullet).some(({ from, to }) => from === bullet.from && to === bullet.to)).toBe(false);

    const orderedText = "outside\n1. item";
    const orderedState = editorState(orderedText, 0);
    const ordered = nodes(orderedState, "ListMark")[0];
    expect(ordered).toBeDefined();
    if (!ordered) return;
    expect(ranges(orderedState).some(({ from, to, decoration }) =>
      from === ordered.from && to === ordered.to && decoration.spec.class === "cm-hive-preview-ordered-marker",
    )).toBe(true);
    expect(ranges(editorState(orderedText, ordered.from)).some(({ from, to, decoration }) =>
      from === ordered.from && to === ordered.to && decoration.spec.class === "cm-hive-preview-ordered-marker",
    )).toBe(false);
  });

  it("uses a checkbox for task markers until the caret enters the marker", () => {
    const doc = "outside\n- [ ] task text";
    const inactive = editorState(doc, 0);
    const marker = nodes(inactive, "TaskMarker")[0];
    expect(marker).toBeDefined();
    if (!marker) return;
    const widget = ranges(inactive).find(({ from, to }) => from === marker.from && to === marker.to);
    expect(widget?.decoration.spec.widget?.constructor.name).toBe("PreviewCheckboxWidget");
    expect(ranges(editorState(doc, marker.from + 1)).some(({ from, to }) => from === marker.from && to === marker.to)).toBe(false);
    expect(ranges(editorState(doc, marker.to + 2)).find(({ from, to }) => from === marker.from && to === marker.to)?.decoration.spec.widget?.constructor.name)
      .toBe("PreviewCheckboxWidget");
  });

  it("renders quotes and horizontal rules as widgets until their line is active", () => {
    const quoteText = "outside\n> quoted";
    const quoteState = editorState(quoteText, 0);
    const quote = nodes(quoteState, "QuoteMark")[0];
    expect(quote).toBeDefined();
    if (!quote) return;
    expect(ranges(quoteState).find(({ from, to }) => from === quote.from && to === quote.to)?.decoration.spec.widget?.constructor.name)
      .toBe("PreviewTextWidget");
    expect(ranges(editorState(quoteText, quote.to + 2)).some(({ from, to }) => from === quote.from && to === quote.to)).toBe(false);

    const ruleText = "outside\n\n---\n\nafter";
    const ruleState = editorState(ruleText, 0);
    const rule = nodes(ruleState, "HorizontalRule")[0];
    expect(rule).toBeDefined();
    if (!rule) return;
    expect(ranges(ruleState).find(({ from, to }) => from === rule.from && to === rule.to)?.decoration.spec.widget?.constructor.name)
      .toBe("PreviewRuleWidget");
    expect(ranges(editorState(ruleText, rule.from)).some(({ from, to }) => from === rule.from && to === rule.to)).toBe(false);
  });

  it("hides code fences outside the block and only decorates the visible tree ranges", () => {
    const doc = "outside\n```ts\nconst value = 1;\n```\nafter";
    const outside = editorState(doc, 0);
    const fence = nodes(outside, "FencedCode")[0];
    expect(fence).toBeDefined();
    if (!fence) return;
    const marks = fence.getChildren("CodeMark");
    const hidden = hiddenRanges(outside);
    const info = fence.getChild("CodeInfo");
    expect(hidden).toContainEqual(expect.objectContaining({ from: marks[0]?.from, to: info?.to ?? marks[0]?.to }));
    expect(hidden).toContainEqual(expect.objectContaining({ from: marks.at(-1)?.from, to: marks.at(-1)?.to }));
    expect(hiddenRanges(editorState(doc, fence.from + 8))).toEqual([]);

    const inlineDoc = "**first** and **second**";
    const secondFrom = inlineDoc.indexOf("second");
    const visible = buildLivePreviewDecorationSets(editorState(inlineDoc, 0), [{ from: secondFrom, to: inlineDoc.length }]);
    const visibleRanges: Array<{ from: number; to: number }> = [];
    visible.decorations.between(0, inlineDoc.length, (from, to) => { visibleRanges.push({ from, to }); });
    expect(visibleRanges.every(({ from, to }) => to >= secondFrom && from <= inlineDoc.length)).toBe(true);
    expect(visibleRanges.some(({ from, to }) => from === 0 && to === 2)).toBe(false);
  });
});
