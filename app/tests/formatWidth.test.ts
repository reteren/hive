import { afterEach, describe, expect, it } from "vitest";
import type { MediaRef } from "../src/attachments/types";
import { createFormatNotes, FORMAT_INITIAL_HEIGHT } from "../src/formats/formatCreation";
import { formatWrapsExtension, formatWrapsLines } from "../src/formats/formatWrapping";
import { createMarkdownNotes, MAX_IMPORTED_NOTE_HEIGHT } from "../src/formats/textDrop";
import { clear as clearHistory } from "../src/history/history.svelte";
import { board, replaceBoard } from "../src/model/board.svelte";
import { DEFAULT_NOTE_WIDTH } from "../src/model/note";
import { maximumNoteWidthForKind } from "../src/notes/layout.svelte";
import { defaultWidthForKind, minimumWidthForKind } from "../src/selection/resize";

const sources = import.meta.glob<string>(
  "../src/formats/{FormatNodeBody.svelte,formatEditor.ts}",
  { eager: true, query: "?raw", import: "default" },
);

afterEach(() => {
  clearHistory();
  replaceBoard([]);
});

describe("Format node width and wrapping", () => {
  it("creates a huge single-line text file at the Markdown width with a capped height", () => {
    const text = "x".repeat(100_000);
    const [markdownId] = createMarkdownNotes([{ path: "C:\\large.md", text }], { x: 0, y: 0 });
    const ref: MediaRef = {
      file: `${"a".repeat(64)}.txt`, mime: "text/plain", size: text.length, name: "large.txt", kind: "text",
    };
    const [formatId] = createFormatNotes([ref], { x: 0, y: 0 });
    const markdown = board.notes[markdownId!]!;
    const format = board.notes[formatId!]!;
    expect(markdown.height).toBe(MAX_IMPORTED_NOTE_HEIGHT);
    expect(format.width).toBe(markdown.width);
    expect(format.width).toBe(DEFAULT_NOTE_WIDTH);
    expect(format.height).toBe(FORMAT_INITIAL_HEIGHT);
    expect(format.height).toBeLessThanOrEqual(MAX_IMPORTED_NOTE_HEIGHT);
    expect(defaultWidthForKind("format")).toBe(DEFAULT_NOTE_WIDTH);
    expect(minimumWidthForKind("format")).toBe(DEFAULT_NOTE_WIDTH);
    expect(maximumNoteWidthForKind("format")).toBe(maximumNoteWidthForKind("note"));
  });

  it("wraps prose-like formats while code keeps its horizontal viewport", () => {
    for (const language of ["plain", "markdown", "csv", "ini"]) {
      expect(formatWrapsLines(language)).toBe(true);
    }
    for (const language of ["json", "python", "javascript", "typescript", "css", "html", "yaml", "xml"]) {
      expect(formatWrapsLines(language)).toBe(false);
    }
    for (const extension of ["txt", "log", ".MD", "csv", "ini"]) {
      expect(formatWrapsExtension(extension)).toBe(true);
    }
    for (const extension of ["json", "py", "js", "ts", "css", "html", "yaml", "xml"]) {
      expect(formatWrapsExtension(extension)).toBe(false);
    }
  });

  it("keeps legacy auto-height Format bodies bounded and wrapping independent of highlighting", () => {
    const body = sources["../src/formats/FormatNodeBody.svelte"];
    const editor = sources["../src/formats/formatEditor.ts"];
    expect(body).toMatch(/\.format-node-body\s*\{[^}]*height:\s*340px;[^}]*min-height:\s*0/s);
    expect(editor).toContain("const wrapLines = FORMAT_WRAP_LINES || formatWrapsExtension(extension)");
    expect(editor).toContain("const language = highlight ? formatLanguageForExtension(extension) : \"plain\"");
    expect(editor).toMatch(/wrapLines \? \[EditorView\.lineWrapping\] : \[\]/);
    expect(editor).toMatch(/overflowX:\s*wrapLines \? "hidden" : "auto"/);
  });
});
