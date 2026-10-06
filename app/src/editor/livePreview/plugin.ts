import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { isLivePreviewNodeActive, selectionTouchesRange } from "./activation";
import { PreviewCheckboxWidget, PreviewRuleWidget, PreviewTextWidget } from "./widgets";

export interface VisibleRange {
  from: number;
  to: number;
}

export interface LivePreviewDecorationSets {
  decorations: DecorationSet;
  atomicRanges: DecorationSet;
}

function children(node: SyntaxNode, name: string): SyntaxNode[] {
  return node.getChildren(name).sort((left, right) => left.from - right.from);
}

function hiddenRange(from: number, to: number): Range<Decoration> | null {
  if (to <= from) return null;
  return { from, to, value: Decoration.replace({}) };
}

function widgetRange(from: number, to: number, widget: WidgetType): Range<Decoration> | null {
  if (to <= from) return null;
  return { from, to, value: Decoration.replace({ widget }) };
}

function markedRange(from: number, to: number, className: string): Range<Decoration> | null {
  if (to <= from) return null;
  return { from, to, value: Decoration.mark({ class: className }) };
}

function highlightRange(node: SyntaxNode): { from: number; to: number } {
  const color = node.nextSibling;
  return {
    from: node.from,
    to: color?.name === "HiveHighlightColor" && color.from === node.to ? color.to : node.to,
  };
}

function addUnique(
  ranges: Range<Decoration>[],
  range: Range<Decoration> | null,
  keys: Set<string>,
): void {
  if (!range) return;
  const decoration = range.value;
  const className = decoration.spec.class ?? decoration.spec.widget?.constructor.name ?? "replace";
  const key = `${range.from}:${range.to}:${className}`;
  if (keys.has(key)) return;
  keys.add(key);
  ranges.push(range);
}

/** Build live-preview ranges from only CodeMirror's visible syntax-tree ranges. */
export function buildLivePreviewDecorationSets(
  state: EditorState,
  visibleRanges: readonly VisibleRange[],
): LivePreviewDecorationSets {
  const decorations: Range<Decoration>[] = [];
  const atomicRanges: Range<Decoration>[] = [];
  const decorationKeys = new Set<string>();
  const atomicKeys = new Set<string>();
  const tree = syntaxTree(state);

  const add = (range: Range<Decoration> | null, atomic = false): void => {
    addUnique(decorations, range, decorationKeys);
    if (atomic) addUnique(atomicRanges, range, atomicKeys);
  };
  const hide = (from: number, to: number): void => add(hiddenRange(from, to), true);

  for (const visible of visibleRanges) {
    if (visible.to <= visible.from) continue;
    tree.iterate({
      from: visible.from,
      to: visible.to,
      enter(ref) {
        const node = ref.node;
        const name = node.name;
        if (name === "Document" || name === "Paragraph") return;

        if (name === "FencedCode") {
          const active = isLivePreviewNodeActive(node, state.selection, state.doc);
          if (!active) {
            const marks = children(node, "CodeMark");
            const opening = marks[0];
            const info = node.getChild("CodeInfo");
            if (opening) hide(opening.from, info?.to ?? opening.to);
            if (marks.length > 1) hide(marks[marks.length - 1].from, marks[marks.length - 1].to);
          }
          const code = node.getChild("CodeText");
          if (code) add(markedRange(code.from, code.to, "cm-hive-preview-code-block"));
          return false;
        }

        if (name === "Image") return false;

        if (/^ATXHeading[1-6]$/u.test(name)) {
          const active = isLivePreviewNodeActive(node, state.selection, state.doc);
          const level = name.slice(-1);
          add(markedRange(node.from, node.to, `cm-hive-preview-heading cm-hive-preview-heading-${level}`));
          if (!active) {
            for (const marker of children(node, "HeaderMark")) {
              // Hide "# " together with its trailing space so the heading text starts at the edge.
              const space = state.doc.sliceString(marker.to, marker.to + 1) === " " ? 1 : 0;
              hide(marker.from, marker.to + space);
            }
          }
          return;
        }

        if (name === "StrongEmphasis" || name === "Emphasis" || name === "Strikethrough" || name === "InlineCode") {
          const active = isLivePreviewNodeActive(node, state.selection, state.doc);
          const markerName = name === "InlineCode" ? "CodeMark"
            : name === "Strikethrough" ? "StrikethroughMark" : "EmphasisMark";
          const markers = children(node, markerName);
          const contentFrom = markers[0]?.to ?? node.from;
          const contentTo = markers.at(-1)?.from ?? node.to;
          const className = name === "StrongEmphasis" ? "cm-hive-preview-strong"
            : name === "Emphasis" ? "cm-hive-preview-emphasis"
              : name === "Strikethrough" ? "cm-hive-preview-strikethrough" : "cm-hive-preview-inline-code";
          add(markedRange(contentFrom, contentTo, className));
          if (!active) for (const marker of markers) hide(marker.from, marker.to);
          return;
        }

        if (name === "HiveHighlight") {
          const active = selectionTouchesRange(state.selection, node.from, highlightRange(node).to);
          const markers = children(node, "HiveHighlightMark");
          if (!active) for (const marker of markers) hide(marker.from, marker.to);
          const color = node.nextSibling;
          if (!active && color?.name === "HiveHighlightColor" && color.from === node.to) hide(color.from, color.to);
          return;
        }

        if (name === "HiveHighlightColor") {
          const highlight = node.prevSibling;
          if (highlight?.name === "HiveHighlight" && highlight.to === node.from) {
            const range = highlightRange(highlight);
            if (!selectionTouchesRange(state.selection, range.from, range.to)) hide(node.from, node.to);
          }
          return;
        }

        if (name === "ListMark") {
          const list = node.parent?.parent;
          const active = isLivePreviewNodeActive(node, state.selection, state.doc);
          if (list?.name === "BulletList") {
            if (!active) add(widgetRange(node.from, node.to, new PreviewTextWidget("•", "cm-hive-preview-bullet")), true);
          } else if (list?.name === "OrderedList" && !active) {
            add(markedRange(node.from, node.to, "cm-hive-preview-ordered-marker"));
          }
          return;
        }

        if (name === "TaskMarker") {
          if (!isLivePreviewNodeActive(node, state.selection, state.doc)) {
            const source = state.doc.sliceString(node.from, node.to);
            add(widgetRange(node.from, node.to, new PreviewCheckboxWidget(/^\[[xX]\]$/u.test(source), node.from)), true);
          }
          return;
        }

        if (name === "Task") {
          const marker = node.getChild("TaskMarker");
          if (marker && /^\[[xX]\]$/u.test(state.doc.sliceString(marker.from, marker.to))) {
            add(markedRange(marker.to, node.to, "cm-hive-preview-task-done"));
          }
          return;
        }

        if (name === "Blockquote") {
          add(markedRange(node.from, node.to, "cm-hive-preview-blockquote"));
          return;
        }

        if (name === "QuoteMark") {
          if (!isLivePreviewNodeActive(node, state.selection, state.doc)) {
            add(widgetRange(node.from, node.to, new PreviewTextWidget("│", "cm-hive-preview-quote-mark")), true);
          }
          return;
        }

        if (name === "HorizontalRule") {
          if (!isLivePreviewNodeActive(node, state.selection, state.doc)) {
            add(widgetRange(node.from, node.to, new PreviewRuleWidget()), true);
          }
        }
      },
    });
  }

  return {
    decorations: Decoration.set(decorations, true),
    atomicRanges: Decoration.set(atomicRanges, true),
  };
}

export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomicRanges: DecorationSet;

    constructor(view: EditorView) {
      const sets = buildLivePreviewDecorationSets(view.state, view.visibleRanges);
      this.decorations = sets.decorations;
      this.atomicRanges = sets.atomicRanges;
    }

    update(update: import("@codemirror/view").ViewUpdate): void {
      if (!update.docChanged && !update.selectionSet && !update.viewportChanged) return;
      const sets = buildLivePreviewDecorationSets(update.state, update.view.visibleRanges);
      this.decorations = sets.decorations;
      this.atomicRanges = sets.atomicRanges;
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomicRanges ?? Decoration.none),
  },
);

export function livePreviewDecorations(view: EditorView): DecorationSet {
  return view.plugin(livePreviewPlugin)?.decorations ?? Decoration.none;
}
