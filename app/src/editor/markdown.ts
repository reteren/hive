import { hiveMarkdownParser } from "./markdownSyntax";
import { coloredHighlights, getContrastingTextColor } from "./highlight";

const maxCachedEntries = 128;
const maxCachedCharacters = 512_000;
const maxSingleCachedText = 64_000;
type MarkdownTree = ReturnType<typeof hiveMarkdownParser.parse>;

const parsedMarkdown = new Map<string, MarkdownTree>();
let cachedCharacters = 0;

type MarkdownNode = MarkdownTree["topNode"];

interface RenderOptions {
  from?: number;
  to?: number;
  skip?: ReadonlySet<string>;
  trimAfterSkipped?: boolean;
  trimFirstWhitespace?: boolean;
  trimEdges?: boolean;
  highlights?: ReadonlyMap<number, ReturnType<typeof coloredHighlights>[number]>;
  consumedColorSuffixes?: ReadonlySet<number>;
}

export function parseMarkdown(text: string): MarkdownTree {
  const cached = parsedMarkdown.get(text);
  if (cached) {
    parsedMarkdown.delete(text);
    parsedMarkdown.set(text, cached);
    return cached;
  }

  const tree = hiveMarkdownParser.parse(text);
  if (text.length <= maxSingleCachedText) {
    while (
      parsedMarkdown.size >= maxCachedEntries ||
      cachedCharacters + text.length > maxCachedCharacters
    ) {
      const oldest = parsedMarkdown.keys().next().value;
      if (oldest === undefined) break;
      cachedCharacters -= oldest.length;
      parsedMarkdown.delete(oldest);
    }
    parsedMarkdown.set(text, tree);
    cachedCharacters += text.length;
  }
  return tree;
}

export function createMarkdownFragment(text: string, doc: Document = document): DocumentFragment {
  const tree = parseMarkdown(text);
  const fragment = doc.createDocumentFragment();
  const ranges = coloredHighlights(text, tree);
  const highlights = new Map(ranges.map((highlight) => [highlight.from, highlight]));
  const consumedColorSuffixes = new Set(
    ranges.filter((highlight) => highlight.hasColorSuffix).map((highlight) => highlight.to),
  );
  renderChildren(tree.topNode, fragment, text, doc, { highlights, consumedColorSuffixes });
  return fragment;
}

function nodes(node: MarkdownNode): MarkdownNode[] {
  const result: MarkdownNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
  return result;
}

function appendText(parent: Node, doc: Document, text: string): void {
  if (text) parent.appendChild(doc.createTextNode(text));
}

function element(doc: Document, parent: Node, tag: string, className?: string): HTMLElement {
  const result = doc.createElement(tag);
  if (className) result.className = className;
  parent.appendChild(result);
  return result;
}

function renderChildren(
  node: MarkdownNode,
  parent: Node,
  source: string,
  doc: Document,
  options: RenderOptions = {},
): void {
  const start = options.from ?? node.from;
  const end = options.to ?? node.to;
  const skip = options.skip ?? new Set<string>();
  let cursor = start;
  let trimAfterSkipped = false;
  let firstText = true;

  const addGap = (to: number) => {
    if (to <= cursor) return;
    let gap = source.slice(cursor, to);
    if (firstText && options.trimFirstWhitespace) gap = gap.replace(/^[\t\n\r ]+/u, "");
    if (trimAfterSkipped) gap = gap.replace(/^[\t ]+/u, "");
    if (options.trimEdges) gap = gap.trim();
    appendText(parent, doc, gap);
    if (gap) firstText = false;
    trimAfterSkipped = false;
  };

  for (const child of nodes(node)) {
    if (child.to <= start) continue;
    if (child.from >= end) break;
    addGap(Math.min(child.from, end));
    if (
      child.name === "HiveHighlightColor" &&
      options.consumedColorSuffixes?.has(child.from)
    ) {
      cursor = Math.min(child.to, end);
      continue;
    }
    if (skip.has(child.name)) {
      cursor = Math.min(child.to, end);
      trimAfterSkipped = options.trimAfterSkipped ?? false;
      continue;
    }
    renderNode(child, parent, source, doc, options);
    cursor = Math.max(cursor, Math.min(child.to, end));
    trimAfterSkipped = false;
  }
  addGap(end);
}

function renderNode(
  node: MarkdownNode,
  parent: Node,
  source: string,
  doc: Document,
  options: RenderOptions,
): void {
  const name = node.name;
  if (name === "Document") {
    for (const child of nodes(node)) renderNode(child, parent, source, doc, options);
    return;
  }

  if (name === "Paragraph") {
    const paragraph = element(doc, parent, "p");
    renderChildren(node, paragraph, source, doc, options);
    return;
  }

  if (/^ATXHeading[1-6]$/u.test(name)) {
    const marker = nodes(node).find((child) => child.name === "HeaderMark");
    let contentFrom = marker?.to ?? node.from;
    while (contentFrom < node.to && /[\t ]/u.test(source[contentFrom])) contentFrom += 1;
    const heading = element(doc, parent, `h${name.slice(-1)}`);
    renderChildren(node, heading, source, doc, {
      ...options,
      from: contentFrom,
      skip: new Set(["HeaderMark"]),
    });
    return;
  }

  if (name === "SetextHeading1" || name === "SetextHeading2") {
    const marker = nodes(node).find((child) => child.name === "HeaderMark");
    let contentTo = marker?.from ?? node.to;
    while (contentTo > node.from && /[\t\n\r ]/u.test(source[contentTo - 1])) contentTo -= 1;
    const heading = element(doc, parent, name.endsWith("1") ? "h1" : "h2");
    renderChildren(node, heading, source, doc, {
      ...options,
      to: contentTo,
      skip: new Set(["HeaderMark"]),
      trimEdges: true,
    });
    return;
  }

  if (name === "StrongEmphasis" || name === "Emphasis" || name === "Strikethrough") {
    const tag = name === "StrongEmphasis" ? "strong" : name === "Emphasis" ? "em" : "s";
    const formatted = element(doc, parent, tag);
    renderChildren(node, formatted, source, doc, {
      ...options,
      skip: new Set(["EmphasisMark", "StrikethroughMark"]),
    });
    return;
  }

  if (name === "InlineCode") {
    const code = element(doc, parent, "code", "md-inline-code");
    const marks = node.getChildren("CodeMark");
    const from = marks[0]?.to ?? node.from;
    const to = marks.at(-1)?.from ?? node.to;
    appendText(code, doc, source.slice(from, to).replace(/[\r\n]+/gu, " "));
    return;
  }

  if (name === "HiveHighlight") {
    const highlight = options.highlights?.get(node.from);
    const mark = element(doc, parent, "mark", "md-highlight");
    if (highlight) {
      mark.style.backgroundColor = highlight.color;
      mark.style.color = getContrastingTextColor(highlight.color);
    }
    renderChildren(node, mark, source, doc, {
      ...options,
      skip: new Set(["HiveHighlightMark"]),
    });
    return;
  }

  if (name === "HiveHighlightColor") {
    appendText(parent, doc, source.slice(node.from, node.to));
    return;
  }

  if (name === "Link" || name === "Image" || name === "Autolink" || name === "URL") {
    const label = element(doc, parent, "span", "md-link-text");
    if (name === "URL") {
      appendText(label, doc, source.slice(node.from, node.to));
    } else {
      renderChildren(node, label, source, doc, {
        ...options,
        skip: new Set(["LinkMark", "URL", "LinkTitle"]),
      });
    }
    return;
  }

  if (name === "FencedCode" || name === "CodeBlock") {
    const pre = element(doc, parent, "pre", "md-code-block");
    const code = element(doc, pre, "code");
    const codeText = node.getChildren("CodeText");
    if (codeText.length > 0) {
      const start = codeText[0].from;
      let end = codeText.at(-1)!.to;
      if (name === "FencedCode") {
        const closing = node.getChildren("CodeMark").at(-1);
        if (closing && source[end] === "\n" && end + 1 === closing.from) end += 1;
      }
      appendText(code, doc, source.slice(start, end));
    } else if (name === "CodeBlock") {
      appendText(code, doc, source.slice(node.from, node.to));
    }
    return;
  }

  if (name === "BulletList" || name === "OrderedList") {
    const list = element(doc, parent, name === "BulletList" ? "ul" : "ol");
    if (name === "OrderedList") {
      const firstItem = node.getChild("ListItem");
      const marker = firstItem?.getChild("ListMark");
      const start = marker ? Number.parseInt(source.slice(marker.from, marker.to), 10) : 1;
      if (Number.isInteger(start) && start > 1) list.setAttribute("start", String(start));
    }
    for (const child of nodes(node)) {
      if (child.name === "ListItem") renderNode(child, list, source, doc, options);
    }
    return;
  }

  if (name === "ListItem") {
    const item = element(doc, parent, "li");
    renderChildren(node, item, source, doc, {
      ...options,
      skip: new Set(["ListMark"]),
      trimAfterSkipped: true,
    });
    return;
  }

  if (name === "Task") {
    const marker = node.getChild("TaskMarker");
    const checked = marker ? /^\[[xX]\]$/u.test(source.slice(marker.from, marker.to)) : false;
    const checkbox = element(doc, parent, "span", `md-task-checkbox${checked ? " is-checked" : ""}`);
    checkbox.setAttribute("role", "checkbox");
    checkbox.setAttribute("aria-checked", String(checked));
    checkbox.setAttribute("aria-disabled", "true");
    if (marker) {
      renderChildren(node, parent, source, doc, {
        ...options,
        from: marker.to,
        skip: new Set(["TaskMarker"]),
        trimFirstWhitespace: true,
      });
    }
    return;
  }

  if (name === "Blockquote") {
    const quote = element(doc, parent, "blockquote");
    renderChildren(node, quote, source, doc, {
      ...options,
      skip: new Set(["QuoteMark"]),
      trimAfterSkipped: true,
    });
    return;
  }

  if (name === "HorizontalRule") {
    element(doc, parent, "hr");
    return;
  }

  if (name === "HardBreak") {
    element(doc, parent, "br");
    return;
  }

  if (name === "Table") {
    renderTable(node, parent, source, doc, options);
    return;
  }

  if (name === "HTMLBlock" || name === "HTMLTag" || name === "HTMLInline") {
    appendText(parent, doc, source.slice(node.from, node.to));
    return;
  }

  appendText(parent, doc, source.slice(node.from, node.to));
}

function renderTable(
  node: MarkdownNode,
  parent: Node,
  source: string,
  doc: Document,
  options: RenderOptions,
): void {
  const table = element(doc, parent, "table", "md-table");
  const header = node.getChild("TableHeader");
  const rows = node.getChildren("TableRow");
  if (header) {
    const thead = element(doc, table, "thead");
    renderTableRow(header, thead, true, source, doc, options);
  }
  if (rows.length > 0) {
    const tbody = element(doc, table, "tbody");
    for (const row of rows) renderTableRow(row, tbody, false, source, doc, options);
  }
}

function renderTableRow(
  node: MarkdownNode,
  parent: Node,
  heading: boolean,
  source: string,
  doc: Document,
  options: RenderOptions,
): void {
  const row = element(doc, parent, "tr");
  for (const cell of node.getChildren("TableCell")) {
    const elementTag = heading ? "th" : "td";
    const tableCell = element(doc, row, elementTag);
    renderChildren(cell, tableCell, source, doc, { ...options, trimEdges: true });
  }
}
