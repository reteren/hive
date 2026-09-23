import { describe, expect, it } from "vitest";
import {
  formatNoteAddress,
  formatNoteMarkdownLink,
  formatPointAddress,
  parseTextLink,
  textLinkStyleClass,
} from "../src/links-in-text/format";

describe("text link addresses", () => {
  it("maps supported link kinds to distinct visual classes", () => {
    expect(textLinkStyleClass({ kind: "note", noteId: "id" })).toBe("is-note-link");
    expect(textLinkStyleClass({ kind: "point", point: { x: 1, y: 2 } })).toBe("is-point-link");
    expect(textLinkStyleClass({ kind: "external", url: "https://example.test/" })).toBe("is-external-link");
  });

  it("parses point addresses with negative and decimal coordinates", () => {
    expect(parseTextLink("hive://point/12.5,-40")).toEqual({
      kind: "point",
      point: { x: 12.5, y: -40 },
    });
    expect(parseTextLink("hive://point/-.25,.75")).toEqual({
      kind: "point",
      point: { x: -0.25, y: 0.75 },
    });
  });

  it("rejects malformed or non-finite point values", () => {
    for (const address of [
      "hive://point/NaN,1",
      "hive://point/Infinity,1",
      "hive://point/1,2,3",
      "hive://point/1,2?zoom=4",
      "hive://point/1/2",
    ]) {
      expect(parseTextLink(address)).toBeNull();
    }
  });

  it("parses only http and https as external links", () => {
    expect(parseTextLink("https://example.test/a?q=1")).toEqual({
      kind: "external",
      url: "https://example.test/a?q=1",
    });
    expect(parseTextLink("http://example.test")).toEqual({
      kind: "external",
      url: "http://example.test/",
    });
    expect(parseTextLink("javascript:alert(1)")).toBeNull();
    expect(parseTextLink("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(parseTextLink("file:///C:/secret.txt")).toBeNull();
  });

  it("round-trips portable point and note addresses", () => {
    const pointAddress = formatPointAddress({ x: 12.34567, y: -40 });
    expect(pointAddress).toBe("hive://point/12.346,-40");
    expect(parseTextLink(pointAddress)).toEqual({ kind: "point", point: { x: 12.346, y: -40 } });

    const noteAddress = formatNoteAddress("id/with space");
    expect(noteAddress).toBe("hive://note/id%2Fwith%20space");
    expect(parseTextLink(noteAddress)).toEqual({ kind: "note", noteId: "id/with space" });
    expect(formatNoteMarkdownLink("A [name]", "note-id")).toBe("[A \\[name\\]](hive://note/note-id)");
  });

  it("refuses invalid values when producing addresses", () => {
    expect(() => formatPointAddress({ x: Number.NaN, y: 0 })).toThrow(RangeError);
    expect(() => formatNoteAddress(" ")).toThrow(RangeError);
  });
});
