import { describe, expect, it } from "vitest";
import { FORMAT_WRAP_LINES } from "../src/formats/formatEditor";
import { formatWheelUsesEditor } from "../src/formats/formatScroll";
import { minimumHeightForKind } from "../src/selection/resize";

const sources = import.meta.glob<string>(
  "../src/formats/{FormatNodeBody.svelte,formatEditor.ts}",
  { eager: true, query: "?raw", import: "default" },
);
function scroller(top: number, left = 0) {
  return {
    scrollTop: top, clientHeight: 100, scrollHeight: 300,
    scrollLeft: left, clientWidth: 100, scrollWidth: 250,
  };
}

describe("Format node scrolling", () => {
  it("routes vertical wheel input to CodeMirror until it reaches either end", () => {
    expect(formatWheelUsesEditor(scroller(0), 0, 40)).toBe(true);
    expect(formatWheelUsesEditor(scroller(0), 0, -40)).toBe(false);
    expect(formatWheelUsesEditor(scroller(100), 0, -40)).toBe(true);
    expect(formatWheelUsesEditor(scroller(200), 0, 40)).toBe(false);
    expect(formatWheelUsesEditor(scroller(200), 20, 40)).toBe(false);
    expect(formatWheelUsesEditor({ ...scroller(0), scrollHeight: 100 }, 0, 40)).toBe(false);
  });

  it("keeps horizontal scrolling inside the editor while there is room", () => {
    expect(formatWheelUsesEditor(scroller(0, 0), 30, 0)).toBe(true);
    expect(formatWheelUsesEditor(scroller(0, 0), -30, 0)).toBe(false);
    expect(formatWheelUsesEditor(scroller(0, 75), -30, 0)).toBe(true);
    expect(formatWheelUsesEditor(scroller(0, 150), 30, 0)).toBe(false);
  });

  it("constrains the manual-height body and makes CodeMirror the scroll container", () => {
    const body = sources["../src/formats/FormatNodeBody.svelte"];
    const editor = sources["../src/formats/formatEditor.ts"];
    expect(minimumHeightForKind("format")).toBe(10);
    expect(body).toMatch(/class:manual-height=\{note\.height !== null\}/);
    expect(body).toMatch(/\.format-node-body\.manual-height\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0/s);
    expect(body).toMatch(/\.manual-height \.format-editor,[^}]*min-height:\s*0/s);
    expect(body).toMatch(/class="format-editor"[^>]*onwheel=\{handleWheel\}/);
    expect(body).toMatch(/formatWheelUsesEditor\(view\.scrollDOM, event\.deltaX, event\.deltaY\)/);
    expect(editor).toMatch(/"&":\s*\{[^}]*height:\s*"100%"/s);
    expect(editor).toMatch(/"\.cm-scroller":\s*\{[^}]*height:\s*"100%"[^}]*overflowY:\s*"auto"/s);
    expect(editor).toMatch(/scrollbarWidth:\s*"thin"/);
  });

  it("leaves code lines unwrapped by default behind a single override", () => {
    expect(FORMAT_WRAP_LINES).toBe(false);
    expect(sources["../src/formats/formatEditor.ts"])
      .toMatch(/wrapLines \? \[EditorView\.lineWrapping\] : \[\]/);
  });
});
