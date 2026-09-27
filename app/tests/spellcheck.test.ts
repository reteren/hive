import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { describe, expect, it } from "vitest";
import { mapSpellcheckRangesToLine, spellcheckLineSegments } from "../src/spell/spellcheck";

describe("spellcheck source mapping", () => {
  it("keeps native UTF-16 ranges aligned after astral characters and excluded prefixes", () => {
    const text = "😀 miss";
    const lineFrom = 0;
    const segmentFrom = text.indexOf("miss");
    expect(segmentFrom).toBe(3); // JS, Rust IPC, and CodeMirror positions count the emoji as two UTF-16 units.
    expect(mapSpellcheckRangesToLine(segmentFrom, lineFrom, [{ from: 0, to: 4 }]))
      .toEqual([{ from: 3, to: 7 }]);
  });

  it("skips words in Markdown links, code spans, and URLs", () => {
    const state = EditorState.create({
      doc: "typo [linkedmisspelling](https://host.example/path) `codemisspelling` https://another.example wrongword",
      extensions: [markdown()],
    });
    const line = state.doc.line(1);
    const checked = spellcheckLineSegments(state, line).map((range) => state.sliceDoc(range.from, range.to)).join(" ");

    expect(checked).toContain("typo");
    expect(checked).toContain("wrongword");
    expect(checked).not.toContain("linkedmisspelling");
    expect(checked).not.toContain("codemisspelling");
    expect(checked).not.toContain("another.example");
    expect(checked).not.toContain("host.example");
  });
});
