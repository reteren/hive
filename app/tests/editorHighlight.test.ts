import { describe, expect, it } from "vitest";
import {
  coloredHighlights,
  createHighlightChange,
  DEFAULT_HIGHLIGHT_COLOR,
  getContrastingTextColor,
  serializeHighlight,
} from "../src/editor/highlight";

describe("colored Markdown highlights", () => {
  it("parses and serializes a six-digit color suffix", () => {
    const serialized = serializeHighlight("marked text", "#ABCDEF");
    expect(serialized).toBe("==marked text=={{#abcdef}}");

    const [highlight] = coloredHighlights(serialized);
    expect(highlight).toMatchObject({
      color: "#abcdef",
      hasColorSuffix: true,
      sourceTo: serialized.length,
    });
    expect(serialized.slice(highlight.contentFrom, highlight.contentTo)).toBe("marked text");
  });

  it("uses the shared default color when no suffix is present", () => {
    expect(coloredHighlights("==default==")[0].color).toBe(DEFAULT_HIGHLIGHT_COLOR);
  });

  it("recolors a selection inside a highlight without changing its neighboring color", () => {
    const source = "before ==keep selected keep=={{#112233}} after";
    const from = source.indexOf("selected");
    const to = from + "selected".length;
    const change = createHighlightChange(source, from, to, "#E8B030");

    expect(change).not.toBeNull();
    const updated = source.slice(0, change!.from) + change!.insert + source.slice(change!.to);
    expect(updated).toBe(
      "before ==keep=={{#112233}} ==selected=={{#e8b030}} ==keep=={{#112233}} after",
    );
    expect(updated.slice(change!.selectionFrom, change!.selectionTo)).toBe("selected");
    expect(coloredHighlights(updated).map(({ color }) => color)).toEqual([
      "#112233",
      "#e8b030",
      "#112233",
    ]);
  });

  it("wraps an ordinary selection and leaves an intersecting partial selection unchanged", () => {
    const source = "plain words and ==marked=={{#112233}}";
    const from = source.indexOf("words");
    const wrapped = createHighlightChange(source, from, from + 5, "#abcdef");
    expect(wrapped?.insert).toBe("==words=={{#abcdef}}");

    const partial = createHighlightChange(source, source.indexOf("==marked") + 1, source.length, "#abcdef");
    expect(partial).toBeNull();
  });

  it("chooses the higher contrast text color for light and dark backgrounds", () => {
    expect(getContrastingTextColor("#ffff00")).toBe("#000000");
    expect(getContrastingTextColor("#122033")).toBe("#ffffff");
  });
});
