import type { EditorSelection } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";
import { parseTextLink, type TextLinkTarget } from "../links-in-text/format";
import { hiveMarkdownParser } from "./markdownSyntax";

export interface VisibleRange {
  from: number;
  to: number;
}

export interface MarkdownLinkRange {
  from: number;
  to: number;
  labelFrom: number;
  labelTo: number;
  url: string;
  target: TextLinkTarget;
}

export interface LinkMarkupRange {
  from: number;
  to: number;
}

/** Find supported inline Markdown links intersecting the editor's visible ranges. */
export function visibleMarkdownLinks(
  text: string,
  visibleRanges: readonly VisibleRange[],
): MarkdownLinkRange[] {
  return visibleMarkdownLinksInTree(hiveMarkdownParser.parse(text), text, visibleRanges);
}

/** Uses CodeMirror's incremental Markdown tree and only walks visible lines. */
export function visibleMarkdownLinksInTree(
  tree: Tree,
  text: string,
  visibleRanges: readonly VisibleRange[],
): MarkdownLinkRange[] {
  const found = new Map<string, MarkdownLinkRange>();

  for (const visible of visibleRanges) {
    if (visible.to <= visible.from) continue;
    tree.iterate({
      from: visible.from,
      to: visible.to,
      enter(ref) {
        const node = ref.node;
        if (node.name !== "Link") return;

        const range = linkRange(node, text);
        if (range && range.to > visible.from && range.from < visible.to) {
          found.set(`${range.from}:${range.to}`, range);
        }
        return false;
      },
    });
  }

  return [...found.values()].sort((left, right) => left.from - right.from);
}

/** A caret at or adjacent to a link reveals it; non-empty selections reveal overlapping links. */
export function isMarkdownLinkActive(
  link: Pick<MarkdownLinkRange, "from" | "to">,
  selection: EditorSelection,
): boolean {
  return selection.ranges.some((range) =>
    range.empty
      ? range.from >= link.from && range.from <= link.to
      : range.from < link.to && range.to > link.from,
  );
}

/** Returns the two source fragments hidden for each inactive link. */
export function collapsedLinkMarkup(
  links: readonly MarkdownLinkRange[],
  selection: EditorSelection,
): LinkMarkupRange[] {
  const hidden: LinkMarkupRange[] = [];
  for (const link of links) {
    if (isMarkdownLinkActive(link, selection) || link.labelTo <= link.labelFrom) continue;
    hidden.push({ from: link.from, to: link.labelFrom });
    hidden.push({ from: link.labelTo, to: link.to });
  }
  return hidden;
}

function linkRange(node: SyntaxNode, text: string): MarkdownLinkRange | null {
  const urlNode = node.getChild("URL") ?? node.getChild("HiveAddress");
  if (!urlNode) return null;

  const marks = node.getChildren("LinkMark").sort((left, right) => left.from - right.from);
  const opening = marks[0];
  if (!opening || text.slice(opening.from, opening.to) !== "[") return null;

  const beforeUrl = marks.filter((mark) => mark.to <= urlNode.from && mark.from >= opening.to);
  let labelEnd = beforeUrl.at(-1);
  if (!labelEnd) return null;

  if (text.slice(labelEnd.from, labelEnd.to) === "(") {
    const closingBracket = beforeUrl.at(-2);
    if (closingBracket && text.slice(closingBracket.from, closingBracket.to).endsWith("]")) {
      labelEnd = closingBracket;
    }
  }

  const labelFrom = opening.to;
  const labelTo = labelEnd.from;
  if (labelTo < labelFrom) return null;

  const url = text.slice(urlNode.from, urlNode.to).replace(/^<|>$/gu, "");
  const target = parseTextLink(url);
  if (!target) return null;

  return {
    from: node.from,
    to: node.to,
    labelFrom,
    labelTo,
    url,
    target,
  };
}
