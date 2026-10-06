import { describe, expect, it, vi } from "vitest";
import { measureAndCacheTextMinimumWidth } from "../src/editor/textFitWidth";
import { minimumTextWidthForNote, clearMinimumTextWidth } from "../src/notes/layout.svelte";
import { canScrollTextNote, minimumManualTextHeight, visualTextLineCount, wheelScrollsText } from "../src/notes/textScroll";

const lines = (count: number): string => Array.from({ length: count }, (_, index) => `line ${index}`).join("\n");
const styles = import.meta.glob<string>("../src/editor/{NoteBody,MarkdownPreview}.svelte", { eager: true, query: "?raw", import: "default" });

describe("text note manual scrolling", () => {
  it("keeps 15 or fewer rendered lines at natural height, then permits a viewport", () => {
    const short = { type: "note" as const, width: 30, height: 12, text: lines(15) };
    const long = { ...short, text: lines(16) };
    expect(visualTextLineCount(short.text, short.width)).toBe(15);
    expect(canScrollTextNote(short)).toBe(false);
    expect(minimumManualTextHeight(short, 8.2, 38)).toBe(38);
    expect(canScrollTextNote(long)).toBe(true);
    expect(minimumManualTextHeight(long, 8.2, 40)).toBe(8.2);
    expect(canScrollTextNote({ ...long, height: null })).toBe(false);
  });

  it("counts wrapped lines, including an unbroken Markdown code line", () => {
    const text = "x".repeat(600);
    expect(visualTextLineCount(text, 30)).toBeGreaterThan(15);
    expect(canScrollTextNote({ type: "note", width: 30, height: 80, text })).toBe(true);
    expect(canScrollTextNote({ type: "format", width: 30, height: 12, text: lines(30) })).toBe(false);
  });

  it("uses inner scrolling only while the wheel can move in that direction", () => {
    expect(wheelScrollsText(0, 100, 300, 40)).toBe(true);
    expect(wheelScrollsText(0, 100, 300, -40)).toBe(false);
    expect(wheelScrollsText(100, 100, 300, -40)).toBe(true);
    expect(wheelScrollsText(200, 100, 300, 40)).toBe(false);
    expect(wheelScrollsText(0, 100, 100, 40)).toBe(false);
  });

  it("measures a long unbroken line up to the automatic width limit", () => {
    const id = "wrapped-text-width";
    const context = {
      font: "10px sans-serif",
      measureText: (text: string) => ({ width: text.length * 10 }),
    } as unknown as CanvasRenderingContext2D;
    const content = { offsetWidth: 400 };
    const root = { offsetWidth: 430, querySelector: () => content };
    const source = {
      matches: (selector: string) => selector.includes(".cm-content"),
      closest: () => root,
    };
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => context }) });
    vi.stubGlobal("getComputedStyle", (element: unknown) => element === source
      ? { font: "14px Test", fontStyle: "normal", fontWeight: "400", fontSize: "14px", fontFamily: "Test" }
      : { paddingLeft: "8px", paddingRight: "8px" });
    try {
      expect(measureAndCacheTextMinimumWidth(id, "x".repeat(600), source as unknown as HTMLElement, "note")).toBe(75);
      expect(minimumTextWidthForNote(id, 75)).toBe(75);
    } finally {
      clearMinimumTextWidth(id);
      vi.unstubAllGlobals();
    }
  });

  it("wraps Markdown tables and suppresses horizontal text scrollbars", () => {
    const body = styles["../src/editor/NoteBody.svelte"];
    const preview = styles["../src/editor/MarkdownPreview.svelte"];
    expect(body).toMatch(/\.fixed-height\s*\{[^}]*overflow-x:\s*hidden/s);
    expect(preview).toMatch(/\.md-table\)\s*\{[^}]*table-layout:\s*fixed/s);
    expect(preview).not.toMatch(/overflow-x:\s*auto/);
  });
});
