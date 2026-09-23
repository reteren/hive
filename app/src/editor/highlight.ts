import { hiveMarkdownParser } from "./markdownSyntax";

export const DEFAULT_HIGHLIGHT_COLOR = "#e8b030";

export interface HighlightRange {
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
  sourceTo: number;
  color: string;
  hasColorSuffix: boolean;
}

export interface HighlightChange {
  from: number;
  to: number;
  insert: string;
  selectionFrom: number;
  selectionTo: number;
}

type MarkdownNode = ReturnType<typeof hiveMarkdownParser.parse>["topNode"];
type MarkdownTree = ReturnType<typeof hiveMarkdownParser.parse>;

export function normalizeHexColor(color: string): string | null {
  return /^#[\da-f]{6}$/iu.test(color) ? color.toLowerCase() : null;
}

export function serializeHighlight(text: string, color: string): string {
  const normalized = normalizeHexColor(color);
  if (!normalized) throw new RangeError("Highlight color must be a six-digit hex value");
  return `==${text}=={{${normalized}}}`;
}

export function getContrastingTextColor(color: string): "#000000" | "#ffffff" {
  const normalized = normalizeHexColor(color) ?? DEFAULT_HIGHLIGHT_COLOR;
  const channels = [1, 3, 5].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255);
  const luminance = channels
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);
  return blackContrast >= whiteContrast ? "#000000" : "#ffffff";
}

export function coloredHighlights(
  source: string,
  tree: MarkdownTree = hiveMarkdownParser.parse(source),
): HighlightRange[] {
  const result: HighlightRange[] = [];

  const visit = (parent: MarkdownNode) => {
    for (let node = parent.firstChild; node; node = node.nextSibling) {
      if (node.name === "HiveHighlight") {
        const marks = node.getChildren("HiveHighlightMark");
        if (marks.length >= 2) {
          const suffix = node.nextSibling;
          const hasColorSuffix = Boolean(
            suffix?.name === "HiveHighlightColor" && suffix.from === node.to,
          );
          const suffixText = hasColorSuffix && suffix
            ? source.slice(suffix.from, suffix.to)
            : "";
          const color = normalizeHexColor(suffixText.slice(2, -2)) ?? DEFAULT_HIGHLIGHT_COLOR;

          result.push({
            from: node.from,
            to: node.to,
            contentFrom: marks[0].to,
            contentTo: marks[marks.length - 1].from,
            sourceTo: hasColorSuffix && suffix ? suffix.to : node.to,
            color,
            hasColorSuffix,
          });
        }
      }
      visit(node);
    }
  };

  visit(tree.topNode);
  return result;
}

export function createHighlightChange(
  source: string,
  from: number,
  to: number,
  color: string,
): HighlightChange | null {
  const normalized = normalizeHexColor(color);
  if (!normalized || from < 0 || to > source.length || from >= to) return null;

  const ranges = coloredHighlights(source);
  const containing = ranges.find((range) => from >= range.contentFrom && to <= range.contentTo);
  const intersectsHighlight = ranges.some((range) => from < range.sourceTo && to > range.from);
  if (intersectsHighlight && !containing) return null;

  if (!containing) {
    const part = serializeHighlightPart(source.slice(from, to), normalized);
    if (part.contentLength === 0) return null;
    return {
      from,
      to,
      insert: part.text,
      selectionFrom: from + part.contentStart,
      selectionTo: from + part.contentStart + part.contentLength,
    };
  }

  const before = source.slice(containing.contentFrom, from);
  const selected = source.slice(from, to);
  const after = source.slice(to, containing.contentTo);
  const beforePart = serializeHighlightPart(before, containing.color);
  const selectedPart = serializeHighlightPart(selected, normalized);
  const afterPart = serializeHighlightPart(after, containing.color);
  if (selectedPart.contentLength === 0) return null;
  const insert = beforePart.text + selectedPart.text + afterPart.text;

  return {
    from: containing.from,
    to: containing.sourceTo,
    insert,
    selectionFrom: containing.from + beforePart.text.length + selectedPart.contentStart,
    selectionTo:
      containing.from + beforePart.text.length + selectedPart.contentStart + selectedPart.contentLength,
  };
}

function serializeHighlightPart(
  text: string,
  color: string,
): { text: string; contentStart: number; contentLength: number } {
  const leading = text.match(/^[\t\n\r ]*/u)?.[0] ?? "";
  const trailing = text.slice(leading.length).match(/[\t\n\r ]*$/u)?.[0] ?? "";
  const contentEnd = text.length - trailing.length;
  const content = text.slice(leading.length, contentEnd);
  if (!content) return { text, contentStart: leading.length, contentLength: 0 };

  const serialized = serializeHighlight(content, color);
  return {
    text: `${leading}${serialized}${trailing}`,
    contentStart: leading.length + 2,
    contentLength: content.length,
  };
}
