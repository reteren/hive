import { EditorSelection } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { collapsedLinkMarkup, visibleMarkdownLinks } from "../src/editor/linkPreview";

const source = "[node](hive://note/id) [point](hive://point/-1.5,2) [web](https://example.test) end";
const visible = [{ from: 0, to: source.length }];
const caret = (position: number) => EditorSelection.create([EditorSelection.cursor(position)]);

describe("editor Markdown links", () => {
  it("finds supported inline links and hides only delimiters and destinations when inactive", () => {
    const links = visibleMarkdownLinks(source, visible);
    expect(links.map((link) => [source.slice(link.labelFrom, link.labelTo), link.target.kind])).toEqual([
      ["node", "note"],
      ["point", "point"],
      ["web", "external"],
    ]);

    const hidden = collapsedLinkMarkup(links, caret(source.length));
    expect(hidden).toEqual(links.flatMap((link) => [
      { from: link.from, to: link.labelFrom },
      { from: link.labelTo, to: link.to },
    ]));
  });

  it("reveals link syntax for a caret inside or immediately beside the link", () => {
    const [link] = visibleMarkdownLinks(source, visible);
    expect(link).toBeDefined();
    if (!link) return;

    for (const position of [link.from, link.labelFrom + 1, link.to]) {
      expect(collapsedLinkMarkup([link], caret(position))).toEqual([]);
    }
    expect(collapsedLinkMarkup([link], caret(link.from - 1))).toHaveLength(2);
  });

  it("reveals raw markup when a selection overlaps a link and ignores selection outside it", () => {
    const [link] = visibleMarkdownLinks(source, visible);
    expect(link).toBeDefined();
    if (!link) return;

    const overlapping = EditorSelection.create([EditorSelection.range(link.labelFrom, link.labelFrom + 1)]);
    const outside = EditorSelection.create([EditorSelection.range(link.to + 1, link.to + 2)]);
    expect(collapsedLinkMarkup([link], overlapping)).toEqual([]);
    expect(collapsedLinkMarkup([link], outside)).toHaveLength(2);
  });

  it("limits link discovery to the visible ranges", () => {
    const links = visibleMarkdownLinks(source, [{ from: source.indexOf("web"), to: source.length }]);
    expect(links.map((link) => link.target.kind)).toEqual(["external"]);
  });
});
