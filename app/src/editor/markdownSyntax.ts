import { tags } from "@lezer/highlight";
import { GFM, parser, type MarkdownConfig, type MarkdownExtension } from "@lezer/markdown";

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

export const hiveMarkdownExtensions: MarkdownExtension[] = [...GFM, coloredHighlight, hiveAddress];
export const hiveMarkdownParser = parser.configure(hiveMarkdownExtensions);
