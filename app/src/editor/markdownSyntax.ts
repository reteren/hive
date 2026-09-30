import { tags } from "@lezer/highlight";
import { GFM, parser, type MarkdownConfig, type MarkdownExtension } from "@lezer/markdown";
import { INLINE_IMAGE_DEFAULT_WIDTH_PERCENT, INLINE_IMAGE_PATTERN } from "../attachments/types";

const highlightDelimiter = { resolve: "HiveHighlight", mark: "HiveHighlightMark" };

const coloredHighlight: MarkdownConfig = {
  defineNodes: [
    { name: "HiveHighlight", style: tags.special(tags.content) },
    { name: "HiveHighlightMark", style: tags.processingInstruction },
    { name: "HiveHighlightColor", style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: "HiveHighlightColor",
      before: "Emphasis",
      parse(cx, next, pos) {
        if (next !== 123) return -1;
        const token = cx.slice(pos, pos + 11);
        if (!/^\{\{#[\da-fA-F]{6}\}\}$/u.test(token)) return -1;
        return cx.addElement(cx.elt("HiveHighlightColor", pos, pos + 11));
      },
    },
    {
      name: "HiveHighlight",
      before: "Emphasis",
      parse(cx, next, pos) {
        if (next !== 61 || cx.slice(pos, pos + 2) !== "==") return -1;
        if (cx.slice(pos - 1, pos) === "=" || cx.slice(pos + 2, pos + 3) === "=") return -1;

        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 2, pos + 3);
        const canOpen = after.length > 0 && !/\s/u.test(after);
        const canClose = before.length > 0 && !/\s/u.test(before);
        return cx.addDelimiter(highlightDelimiter, pos, pos + 2, canOpen, canClose);
      },
    },
  ],
};

const hiveAddress: MarkdownConfig = {
  defineNodes: [{ name: "HiveAddress" }],
  parseInline: [
    {
      name: "HiveAddress",
      before: "Autolink",
      parse(cx, next, pos) {
        if (next !== 104 && next !== 72) return -1;
        const rest = cx.slice(pos, pos + 512);
        const match = /^hive:\/\/(?:point\/-?(?:\d+(?:\.\d+)?|\.\d+),-?(?:\d+(?:\.\d+)?|\.\d+)(?![\w.])|note\/[\w~%-]+)/iu.exec(rest);
        return match ? cx.addElement(cx.elt("HiveAddress", pos, pos + match[0].length)) : -1;
      },
    },
  ],
};

const inlineImageTokenPattern = new RegExp(`^${INLINE_IMAGE_PATTERN.source}`, "u");

export interface InlineImageToken {
  alt: string;
  file: string;
  widthPercent: number;
  hasWidth: boolean;
}

export interface InlineImagePreviewEntry extends InlineImageToken {
  marker: string;
}

export interface PreparedMarkdownPreview {
  text: string;
  inlineImages: InlineImagePreviewEntry[];
}

export function parseInlineImageToken(value: string): InlineImageToken | null {
  const match = inlineImageTokenPattern.exec(value);
  if (!match || match[0] !== value) return null;
  const rawWidth = match[3];
  return {
    alt: match[1],
    file: match[2],
    widthPercent: rawWidth === undefined
      ? INLINE_IMAGE_DEFAULT_WIDTH_PERCENT
      : Math.min(100, Math.max(5, Number.parseInt(rawWidth, 10))),
    hasWidth: rawWidth !== undefined,
  };
}

export function formatInlineImageToken(alt: string, file: string, widthPercent: number): string {
  const safeAlt = alt.replace(/[\]\r\n]/gu, " ").trim() || "Image";
  const width = Math.min(100, Math.max(5, Math.round(widthPercent)));
  return `![${safeAlt}](att:${file}){w=${width}}`;
}

/** Replace inline image tokens with their alt text for text-fit measurements. */
export function inlineImageTextForFit(
  text: string,
  tree?: ReturnType<typeof hiveMarkdownParser.parse>,
): string {
  if (!text.includes("![")) return text;
  const replacements: Array<{ from: number; to: number; alt: string }> = [];
  (tree ?? hiveMarkdownParser.parse(text)).iterate({
    enter(node) {
      if (node.name !== "Image") return;
      const parsed = parseInlineImageToken(text.slice(node.from, node.to));
      if (parsed) replacements.push({ from: node.from, to: node.to, alt: parsed.alt });
    },
  });
  let result = text;
  for (const replacement of replacements.reverse()) {
    result = result.slice(0, replacement.from) + replacement.alt + result.slice(replacement.to);
  }
  return result;
}

/** Replace inline-image tokens with safe Markdown image placeholders for the static renderer. */
export function prepareMarkdownPreview(text: string): PreparedMarkdownPreview {
  const matches: Array<{ from: number; to: number; token: InlineImageToken }> = [];
  hiveMarkdownParser.parse(text).iterate({
    enter(node) {
      if (node.name !== "Image") return;
      const token = parseInlineImageToken(text.slice(node.from, node.to));
      if (token) matches.push({ from: node.from, to: node.to, token });
    },
  });
  if (matches.length === 0) return { text, inlineImages: [] };

  let markerPrefix = "hiveinlineimage";
  while (text.includes(markerPrefix)) markerPrefix = `x${markerPrefix}`;
  let cursor = 0;
  let prepared = "";
  const inlineImages = matches.map(({ token }, index) => ({
    ...token,
    marker: `${markerPrefix}${index}token`,
  }));
  matches.forEach(({ from, to }, index) => {
    const marker = inlineImages[index].marker;
    prepared += text.slice(cursor, from) + `![${marker}](https://inline-image.invalid/${index})`;
    cursor = to;
  });
  prepared += text.slice(cursor);
  return { text: prepared, inlineImages };
}

const inlineImages: MarkdownConfig = {
  defineNodes: [{ name: "HiveInlineImage" }],
  parseInline: [
    {
      name: "HiveInlineImage",
      before: "Image",
      parse(cx, next, pos) {
        if (next !== 33) return -1;
        const match = inlineImageTokenPattern.exec(cx.slice(pos, cx.end));
        if (!match) return -1;
        return cx.addElement(cx.elt("Image", pos, pos + match[0].length));
      },
    },
  ],
};

export const hiveMarkdownExtensions: MarkdownExtension[] = [...GFM, coloredHighlight, hiveAddress, inlineImages];
export const hiveMarkdownParser = parser.configure(hiveMarkdownExtensions);
